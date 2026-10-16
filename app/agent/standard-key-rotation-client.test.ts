import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import http from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { loadEd25519PrivateKey } from './ed25519-signer.js';
import type { RotationIdentity } from './standard-key-rotation.js';
import { createRotationRequest } from './standard-key-rotation-client.js';

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

function identity(): RotationIdentity {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const raw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  return {
    keyId: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    privatePem,
    privateKey: loadEd25519PrivateKey(privatePem),
    publicKey: raw.toString('base64'),
  };
}

test('rotation RPC signs the exact method, path and JSON bytes with the selected private key', async () => {
  const key = identity();
  const seen: string[] = [];
  const origin = await listen(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const canonical = `${req.method}\n${req.url}\n${createHash('sha256').update(body).digest('hex')}\n${req.headers['x-portwing-timestamp']}\n${req.headers['x-portwing-nonce']}`;
    expect(req.headers['x-portwing-signature-version']).toBe('2');
    expect(req.headers['x-portwing-key-id']).toBe(key.keyId);
    expect(
      verify(
        null,
        Buffer.from(canonical),
        createPublicKey(key.privateKey),
        Buffer.from(String(req.headers['x-portwing-signature']), 'base64url'),
      ),
    ).toBe(true);
    expect(body.toString()).not.toContain('PRIVATE KEY');
    seen.push(`${req.method} ${req.url} ${body}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ root_key_id: key.keyId, current_key_id: key.keyId }));
  });
  const request = createRotationRequest(origin, {});
  await request(key, 'status');
  await request(key, 'prepare', { public_key: key.publicKey });
  await request(key, 'commit');
  await request(key, 'abort');
  expect(seen).toEqual([
    'GET /_portwing/auth/rotation ',
    `POST /_portwing/auth/rotation/prepare {"public_key":"${key.publicKey}"}`,
    'POST /_portwing/auth/rotation/commit {}',
    'POST /_portwing/auth/rotation/abort {}',
  ]);
});

test('rotation refuses redirects and preserves remote error status for recovery', async () => {
  const key = identity();
  let redirected = false;
  const target = await listen((_req, res) => {
    redirected = true;
    res.end('{}');
  });
  const origin = await listen((req, res) => {
    if (req.url?.endsWith('/commit')) {
      res.writeHead(401);
      res.end('unknown key');
    } else {
      res.writeHead(307, { Location: target });
      res.end();
    }
  });
  const request = createRotationRequest(origin, {});
  await expect(request(key, 'status')).rejects.toMatchObject({ status: 307 });
  expect(redirected).toBe(false);
  await expect(request(key, 'commit')).rejects.toMatchObject({ status: 401 });
});
