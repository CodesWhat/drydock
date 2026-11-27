import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Dockerode from 'dockerode';
import { Server, utils } from 'ssh2';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildDockerSshOptions } from './docker-ssh-options.js';

// End to end: watcher configuration -> dockerode options -> real SSH handshake
// against an in-process sshd that runs `docker system dial-stdio` by bridging
// the exec channel to a fake Docker API.

const hostKey = utils.generateKeyPairSync('ed25519');
const clientKey = utils.generateKeyPairSync('ed25519');
const parsedClientPublic = utils.parseKey(clientKey.public);
if (parsedClientPublic instanceof Error) {
  throw parsedClientPublic;
}

function fingerprintOf(publicKey: string): string {
  const parsed = utils.parseKey(publicKey);
  if (parsed instanceof Error) {
    throw parsed;
  }
  return `SHA256:${createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
}

describe('docker watcher over ssh (in-process sshd)', () => {
  let dockerApi: http.Server;
  let dockerApiPort: number;
  let sshd: Server;
  let sshPort: number;
  let tmpDir: string;
  let keyFile: string;
  const execCommands: string[] = [];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-ssh-e2e-'));
    keyFile = path.join(tmpDir, 'id_ed25519');
    fs.writeFileSync(keyFile, clientKey.private, { mode: 0o600 });

    dockerApi = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ Version: '29.0.0', ApiVersion: '1.51', Url: req.url }));
    });
    await new Promise<void>((resolve) => dockerApi.listen(0, '127.0.0.1', resolve));
    dockerApiPort = (dockerApi.address() as AddressInfo).port;

    sshd = new Server({ hostKeys: [hostKey.private] }, (client) => {
      client.on('authentication', (ctx) => {
        if (ctx.username !== 'drydock') {
          return ctx.reject();
        }
        if (ctx.method === 'password' && ctx.password === 'hunter2') {
          return ctx.accept();
        }
        if (ctx.method === 'publickey') {
          const sameKey =
            ctx.key.algo === parsedClientPublic.type &&
            Buffer.compare(ctx.key.data, parsedClientPublic.getPublicSSH()) === 0;
          if (
            sameKey &&
            (!ctx.signature ||
              parsedClientPublic.verify(ctx.blob as Buffer, ctx.signature, ctx.hashAlgo) === true)
          ) {
            return ctx.accept();
          }
        }
        return ctx.reject();
      });
      client.on('ready', () => {
        client.on('session', (accept) => {
          accept().on('exec', (acceptExec, _reject, info) => {
            execCommands.push(info.command);
            const channel = acceptExec();
            const upstream = net.connect(dockerApiPort, '127.0.0.1');
            channel.pipe(upstream);
            upstream.pipe(channel);
            upstream.on('close', () => channel.end());
          });
        });
      });
      client.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => sshd.listen(0, '127.0.0.1', resolve));
    sshPort = (sshd.address() as AddressInfo).port;
  });

  afterAll(async () => {
    sshd.close();
    dockerApi.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseConfig = () => ({
    host: '127.0.0.1',
    port: sshPort,
    sshuser: 'drydock',
    sshhostkey: fingerprintOf(hostKey.public),
  });

  test('talks to the remote Docker API with a key file and a pinned host key', async () => {
    const docker = new Dockerode(
      buildDockerSshOptions('e2e', { ...baseConfig(), sshkeyfile: keyFile }),
    );
    const version = (await docker.version()) as unknown as { Version: string };
    expect(version.Version).toBe('29.0.0');
    expect(execCommands).toContain('docker system dial-stdio');
  });

  test('authenticates with a password', async () => {
    const docker = new Dockerode(
      buildDockerSshOptions('e2e', { ...baseConfig(), sshpassword: 'hunter2' }),
    );
    const version = (await docker.version()) as unknown as { ApiVersion: string };
    expect(version.ApiVersion).toBe('1.51');
  });

  test('refuses a host whose key does not match the pinned fingerprint', async () => {
    const docker = new Dockerode(
      buildDockerSshOptions('e2e', {
        ...baseConfig(),
        sshhostkey: fingerprintOf(clientKey.public),
        sshkeyfile: keyFile,
      }),
    );
    await expect(docker.version()).rejects.toThrow();
  });

  test('refuses a wrong password', async () => {
    const docker = new Dockerode(
      buildDockerSshOptions('e2e', { ...baseConfig(), sshpassword: 'wrong' }),
    );
    await expect(docker.version()).rejects.toThrow();
  });
});
