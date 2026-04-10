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

function compilePopenBlocker(sourcePath: string, libraryPath: string) {
  const source =
    process.platform === 'darwin'
      ? [
          '#include <errno.h>',
          '#include <stdio.h>',
          '',
          '#define DYLD_INTERPOSE(_replacement, _replacee) \\',
          '  __attribute__((used)) static struct { \\',
          '    const void *replacement; \\',
          '    const void *replacee; \\',
          '  } _interpose_##_replacee \\',
          '    __attribute__((section("__DATA,__interpose"))) = { \\',
          '      (const void *)(unsigned long)&_replacement, \\',
          '      (const void *)(unsigned long)&_replacee \\',
          '    };',
          '',
          'static FILE *block_popen(const char *command, const char *type) {',
          '  (void)command;',
          '  (void)type;',
          '  errno = EPERM;',
          '  return NULL;',
          '}',
          '',
          'DYLD_INTERPOSE(block_popen, popen);',
          '',
        ].join('\n')
      : [
          '#include <errno.h>',
          '#include <stdio.h>',
          '',
          'FILE *popen(const char *command, const char *type) {',
          '  (void)command;',
          '  (void)type;',
          '  errno = EPERM;',
          '  return NULL;',
          '}',
          '',
        ].join('\n');

  fs.writeFileSync(sourcePath, source);

  const args =
    process.platform === 'darwin'
      ? ['-dynamiclib', sourcePath, '-o', libraryPath]
      : ['-shared', '-fPIC', sourcePath, '-o', libraryPath];

  execFileSync('cc', args, { stdio: 'ignore' });
}

function withPopenBlocked(env: NodeJS.ProcessEnv, libraryPath: string): NodeJS.ProcessEnv {
  if (process.platform === 'darwin') {
    return {
      ...env,
      DYLD_FORCE_FLAT_NAMESPACE: '1',
      DYLD_INSERT_LIBRARIES: libraryPath,
    };
  }

  return {
    ...env,
    LD_PRELOAD: libraryPath,
  };
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
  const popenBlockerSourcePath = path.join(tempDir, 'block-popen.c');
  const popenBlockerLibraryPath = path.join(
    tempDir,
    process.platform === 'darwin' ? 'block-popen.dylib' : 'block-popen.so',
  );
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
    compilePopenBlocker(popenBlockerSourcePath, popenBlockerLibraryPath);
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

  test('succeeds against HTTPS without relying on popen()', async () => {
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
        await runProbe(
          binaryPath,
          port,
          withPopenBlocked(
            { ...process.env, DD_SERVER_TLS_ENABLED: 'true' },
            popenBlockerLibraryPath,
          ),
        ),
      ).toBe(0);
    } finally {
      await close(server);
    }
  });
});
