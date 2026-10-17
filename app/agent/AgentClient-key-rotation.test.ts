import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { AgentClient } from './AgentClient.js';
import { StandardKeyRotation } from './standard-key-rotation.js';

const directories: string[] = [];
const servers: http.Server[] = [];
const clients: AgentClient[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
  await expect(client.requestDockerApi('GET', '/_portwing/auth/rotation')).rejects.toThrow(
    'reserved',
  );
  const result = await client.rotateSigningKey('rotate');
  expect(result.current_key_id).not.toBe(originalId);
  expect((await client.rotateSigningKey('abort')).current_key_id).toBe(result.current_key_id);
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

test('rotation requires configured Ed25519 credentials and refuses stopped clients', async () => {
  expect(
    () =>
      new AgentClient('bad', { host: 'localhost', port: 3000, secret: '', rotationdir: '/unused' }),
  ).toThrow('requires Ed25519');
  const client = new AgentClient('edge', { host: 'localhost', port: 3000, secret: '' });
  const status = { enabled: true, current_key_id: 'public' };
  const rotate = vi.fn().mockResolvedValue(status);
  client.edgeAdapter = {
    getSigningKeyRotationStatus: () => status,
    rotateSigningKey: rotate,
  } as never;
  expect(client.getSigningKeyRotationStatus()).toEqual(status);
  expect(await client.rotateSigningKey('abort')).toEqual(status);
  expect(rotate).toHaveBeenCalledWith('abort');
  client.edgeAdapter = undefined;
  client.stop();
  await expect(client.rotateSigningKey('rotate')).rejects.toThrow('not enabled');
});

test.each([false, true])(
  'SSE waits for one pending rotation recovery before opening, recovery failure=%s',
  async (fail) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-recovery-'));
    directories.push(directory);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const keyId = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32))
      .digest('hex')
      .slice(0, 16);
    const manager = new StandardKeyRotation(directory, 'recover', { keyId, privatePem: pem });
    await expect(
      manager.rotate(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    const client = new AgentClient('recover', {
      host: 'localhost',
      port: 3000,
      secret: '',
      authmode: 'ed25519',
      signingkeyid: keyId,
      signingkey: pem,
      rotationdir: directory,
    });
    clients.push(client);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recover = vi.spyOn(client, 'rotateSigningKey').mockImplementation(async () => {
      await gate;
      if (fail) throw new Error('offline');
      return manager.status();
    });
    const open = vi
      .spyOn(client as unknown as { openSse(): void }, 'openSse')
      .mockImplementation(() => {});
    client.startSse();
    client.startSse();
    expect(recover).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
  },
);
