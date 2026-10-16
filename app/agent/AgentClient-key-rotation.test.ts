import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { AgentClient } from './AgentClient.js';

const directories: string[] = [];
const servers: http.Server[] = [];
const clients: AgentClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('AgentClient rotates and resumes ordinary signed Docker requests after restart without changing bootstrap config', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-agent-rotation-'));
  directories.push(directory);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const originalId = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const accepted = new Map([[originalId, publicKey]]);
  let current = originalId;
  let pending: string | undefined;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const keyId = String(req.headers['x-portwing-key-id']);
    const key = accepted.get(keyId);
    const message = `${req.method}\n${req.url}\n${createHash('sha256').update(body).digest('hex')}\n${req.headers['x-portwing-timestamp']}\n${req.headers['x-portwing-nonce']}`;
    if (
      !key ||
      !verify(
        null,
        Buffer.from(message),
        key,
        Buffer.from(String(req.headers['x-portwing-signature']), 'base64url'),
      )
    ) {
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/version') {
      res.end(JSON.stringify({ verifiedKey: keyId }));
      return;
    }
    if (req.url?.endsWith('/prepare')) {
      const pub = Buffer.from(JSON.parse(body.toString()).public_key, 'base64');
      pending = createHash('sha256').update(pub).digest('hex').slice(0, 16);
      accepted.set(
        pending,
        createPublicKey({
          key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]),
          format: 'der',
          type: 'spki',
        }),
      );
    } else if (req.url?.endsWith('/commit')) {
      expect(keyId).toBe(pending);
      accepted.delete(current);
      current = keyId;
      pending = undefined;
    }
    res.end(
      JSON.stringify({
        root_key_id: originalId,
        current_key_id: current,
        ...(pending ? { pending_key_id: pending } : {}),
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config = {
    host: '127.0.0.1',
    port: (server.address() as { port: number }).port,
    secret: '',
    authmode: 'ed25519' as const,
    signingkeyid: originalId,
    signingkey: pem,
    rotationdir: directory,
  };
  const client = new AgentClient('remote', config);
  clients.push(client);
  const result = await client.rotateSigningKey('rotate');
  expect(result.current_key_id).not.toBe(originalId);
  expect(config.signingkey).toBe(pem);
  expect(config.signingkeyid).toBe(originalId);
  const response = await client.requestDockerApi('GET', '/version');
  expect(JSON.parse(response.body.toString()).verifiedKey).toBe(result.current_key_id);
  const restarted = new AgentClient('remote', config);
  clients.push(restarted);
  const afterRestart = await restarted.requestDockerApi('GET', '/version');
  expect(JSON.parse(afterRestart.body.toString()).verifiedKey).toBe(result.current_key_id);
  expect(JSON.stringify(restarted.getSigningKeyRotationStatus())).not.toContain(pem);
});

test('AgentClient keeps managed rotation disabled unless explicitly configured', async () => {
  const client = new AgentClient('legacy', { host: '127.0.0.1', port: 3000, secret: '' });
  clients.push(client);
  expect(client.getSigningKeyRotationStatus()).toEqual({ enabled: false });
  await expect(client.rotateSigningKey('rotate')).rejects.toThrow('not enabled');
});
