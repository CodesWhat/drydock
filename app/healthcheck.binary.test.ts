import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

async function listen(server: http.Server | https.Server) {
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected an ephemeral TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function close(server: http.Server | https.Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runProbe(binaryPath: string, port: number, env: NodeJS.ProcessEnv) {
  return await new Promise<number>((resolve, reject) => {
    execFile(
      binaryPath,
      [String(port)],
      {
        env,
      },
      (error) => {
        if (!error) {
          resolve(0);
          return;
        }
        if (typeof error.code === 'number') {
          resolve(error.code);
          return;
        }
        reject(error);
      },
    );
  });
}

const probeHandler: http.RequestListener = (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"uptime":1}');
    return;
  }
  res.writeHead(404);
  res.end('not found');
};

describe('/bin/healthcheck compatibility', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-healthcheck-test-'));
  const binaryPath = path.join(tempDir, 'healthcheck');
  const keyPath = path.join(tempDir, 'key.pem');
  const certPath = path.join(tempDir, 'cert.pem');
  const sourcePath = path.resolve(import.meta.dirname, '..', 'healthcheck.c');

  beforeAll(() => {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore' },
    );
    execFileSync('cc', ['-Os', sourcePath, '-o', binaryPath], { stdio: 'ignore' });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('succeeds against a plain HTTP /health endpoint', async () => {
    const server = http.createServer(probeHandler);
    const port = await listen(server);
    try {
      expect(await runProbe(binaryPath, port, process.env)).toBe(0);
    } finally {
      await close(server);
    }
  });

  test('succeeds against a self-signed HTTPS /health endpoint when TLS is enabled', async () => {
    const server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      probeHandler,
    );

    const port = await listen(server);
    try {
      expect(
        await runProbe(binaryPath, port, { ...process.env, DD_SERVER_TLS_ENABLED: 'true' }),
      ).toBe(0);
    } finally {
      await close(server);
    }
  });
});
