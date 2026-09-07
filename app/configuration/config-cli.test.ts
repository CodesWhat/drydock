import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { runConfigCommandIfRequested } from './config-cli.js';

function createIoCollector() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (message: string) => out.push(message),
      err: (message: string) => err.push(message),
    },
    out,
    err,
  };
}

const tempDirsToCleanup: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
}

function writeTempFile(dir: string, name: string, contents: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

afterAll(() => {
  for (const dir of tempDirsToCleanup) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const EXAMPLE_FILE_PATH = fileURLToPath(new URL('../../drydock.example.yml', import.meta.url));

describe('runConfigCommandIfRequested: dispatch', () => {
  test('returns null when argv[0] is not "config"', async () => {
    await expect(runConfigCommandIfRequested(['migrate'])).resolves.toBeNull();
  });

  test('returns null for empty argv', async () => {
    await expect(runConfigCommandIfRequested([])).resolves.toBeNull();
  });

  test('returns null for "config migrate" — deferred to main.ts after the file loads', async () => {
    await expect(runConfigCommandIfRequested(['config', 'migrate'])).resolves.toBeNull();
  });

  test('unknown subcommand prints help and exits 1', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'frobnicate'], {
      io: collector.io,
    });
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('Unknown config subcommand: "frobnicate"');
    expect(collector.out.join('\n')).toContain(
      'Usage: node dist/index.js config <migrate|validate|export>',
    );
  });

  test('bare "config" with no subcommand prints help and exits 1', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config'], { io: collector.io });
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('Unknown config subcommand: ""');
  });
});

describe('config validate', () => {
  test('--help prints usage and exits 0', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--help'], {
      io: collector.io,
    });
    expect(result).toBe(0);
    expect(collector.out.join('\n')).toContain('Usage: node dist/index.js config validate');
  });

  test('-h prints usage and exits 0', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '-h'], {
      io: collector.io,
    });
    expect(result).toBe(0);
  });

  test('unknown argument is a usage error, exit 2', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--bogus'], {
      io: collector.io,
    });
    expect(result).toBe(2);
    expect(collector.err.join('\n')).toContain('Unknown argument: --bogus');
    expect(collector.out.join('\n')).toContain('Usage: node dist/index.js config validate');
  });

  test('--file with no value is a usage error, exit 2', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file'], {
      io: collector.io,
    });
    expect(result).toBe(2);
    expect(collector.err.join('\n')).toContain('--file requires a path value');
  });

  test('--file followed by another flag is a usage error, exit 2', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', '--help'], {
      io: collector.io,
    });
    expect(result).toBe(2);
    expect(collector.err.join('\n')).toContain('--file requires a path value');
  });

  test('DD_CONFIG_FILE set and absent is a load error: exit 1, loader message, no crash', async () => {
    const tempDir = makeTempDir('drydock-validate-missing-env-');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate'], {
      io: collector.io,
      env: { DD_CONFIG_FILE: path.join(tempDir, 'does-not-exist.yml') },
    });
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('does not exist');
  });

  test('no --file, no DD_CONFIG_FILE, and no default-path file present validates the bare environment', async () => {
    // Relies on /config/drydock(.yml|.yaml) genuinely not existing on the
    // machine running this test — the same assumption slice 1's own tests
    // make for the default-discovery path (spec-7.1-config-file.md 8.1).
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate'], {
      io: collector.io,
      env: { DD_SERVER_PORT: '3000' },
    });
    expect(result).toBe(0);
    expect(collector.out).toStrictEqual(['Configuration is valid.']);
  });

  test('a valid file (via --file) validates and exits 0', async () => {
    const tempDir = makeTempDir('drydock-validate-valid-');
    const filePath = writeTempFile(
      tempDir,
      'drydock.yml',
      'server:\n  port: 4000\nregistry:\n  ghcr:\n    private:\n      username: scott\n      token:\n        _file: /run/secrets/ghcr\n',
    );
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', filePath], {
      io: collector.io,
      env: {},
    });
    expect(result).toBe(0);
    expect(collector.out).toStrictEqual(['Configuration is valid.']);
    expect(collector.err).toStrictEqual([]);
  });

  test('an invalid file prints each error as "<yaml path>: <message>" and exits 1', async () => {
    const tempDir = makeTempDir('drydock-validate-invalid-');
    const filePath = writeTempFile(tempDir, 'drydock.yml', 'server:\n  port: not-a-number\n');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', filePath], {
      io: collector.io,
      env: {},
    });
    expect(result).toBe(1);
    expect(collector.err).toHaveLength(1);
    expect(collector.err[0]).toMatch(/^server\.port: /);
  });

  test('a load error (DD_CONFIG_FILE-equivalent --file missing) surfaces as exit 1 with the loader message', async () => {
    const tempDir = makeTempDir('drydock-validate-missing-');
    const missingPath = path.join(tempDir, 'nope.yml');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(
      ['config', 'validate', '--file', missingPath],
      { io: collector.io, env: {} },
    );
    expect(result).toBe(1);
    expect(collector.err[0]).toContain(missingPath);
    expect(collector.err[0]).toContain('does not exist');
  });

  test('a file with a malformed value (unknown provider) is reported and exits 1', async () => {
    const tempDir = makeTempDir('drydock-validate-provider-');
    const filePath = writeTempFile(
      tempDir,
      'drydock.yml',
      'registry:\n  nosuchprovider:\n    private:\n      username: scott\n',
    );
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', filePath], {
      io: collector.io,
      env: {},
    });
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('nosuchprovider');
  });

  test('env still wins over the file for the same key (precedence honoured during validate)', async () => {
    const tempDir = makeTempDir('drydock-validate-precedence-');
    const filePath = writeTempFile(tempDir, 'drydock.yml', 'server:\n  port: not-a-number\n');
    const collector = createIoCollector();
    // The env already sets a valid port; env wins, so the file's invalid
    // value for the same key is never even read for validation purposes.
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', filePath], {
      io: collector.io,
      env: { DD_SERVER_PORT: '4000' },
    });
    expect(result).toBe(0);
  });

  test('a base key already set alongside its __FILE marker keeps the base value, only drops the marker', async () => {
    // resolveSecretPlaceholders must not clobber a base key that's already
    // set (env wins over a would-be placeholder) — only fill it in when
    // genuinely unset.
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate'], {
      io: collector.io,
      env: {
        DD_NOTIFICATION_SLACK_MYSLACK_CHANNEL: '#updates',
        DD_NOTIFICATION_SLACK_MYSLACK_TOKEN: 'already-set-value',
        DD_NOTIFICATION_SLACK_MYSLACK_TOKEN__FILE: '/run/secrets/slack',
      },
    });
    expect(result).toBe(0);
  });

  test('a _file secret resolves through a placeholder, not real file I/O — Joi sees it as present', async () => {
    const tempDir = makeTempDir('drydock-validate-secret-');
    const filePath = writeTempFile(
      tempDir,
      'drydock.yml',
      'notification:\n  slack:\n    myslack:\n      channel: "#updates"\n      token:\n        _file: /this/path/does/not/exist/on/this/machine\n',
    );
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', filePath], {
      io: collector.io,
      env: {},
    });
    expect(result).toBe(0);
    expect(collector.out).toStrictEqual(['Configuration is valid.']);
  });

  test('falls back to process.env when no env override is supplied', async () => {
    const tempDir = makeTempDir('drydock-validate-real-env-');
    const filePath = writeTempFile(tempDir, 'drydock.yml', 'server:\n  port: 4000\n');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'validate', '--file', filePath], {
      io: collector.io,
    });
    expect(result).toBe(0);
  });

  test('drydock.example.yml parses and validates', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(
      ['config', 'validate', '--file', EXAMPLE_FILE_PATH],
      { io: collector.io, env: {} },
    );
    expect(collector.err).toStrictEqual([]);
    expect(result).toBe(0);
  });
});

describe('config export', () => {
  test('--help prints usage and exits 0', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export', '--help'], {
      io: collector.io,
    });
    expect(result).toBe(0);
    expect(collector.out.join('\n')).toContain('Usage: node dist/index.js config export');
  });

  test('unknown argument is a usage error, exit 2', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export', '--bogus'], {
      io: collector.io,
    });
    expect(result).toBe(2);
    expect(collector.err.join('\n')).toContain('Unknown argument: --bogus');
  });

  test('--out with no value is a usage error, exit 2', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export', '--out'], {
      io: collector.io,
    });
    expect(result).toBe(2);
    expect(collector.err.join('\n')).toContain('--out requires a path value');
  });

  test('falls back to process.env when no env override is supplied', async () => {
    // CI sets DD_* variables of its own (a server port, for one), so the
    // assertion is on a stubbed key rather than on an empty document.
    vi.stubEnv('DD_SERVER_PORT', '4242');
    try {
      const collector = createIoCollector();
      const result = await runConfigCommandIfRequested(['config', 'export'], {
        io: collector.io,
      });
      expect(result).toBe(0);
      expect(collector.out.join('')).toContain('port: "4242"');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test('an empty DD_* environment prints an empty document and exits 0', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export'], {
      io: collector.io,
      env: { PATH: '/usr/bin' },
    });
    expect(result).toBe(0);
    expect(collector.out).toStrictEqual(['{}\n']);
  });

  test('inlines a non-secret value, nested by the same rule flatten.ts uses in reverse', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export'], {
      io: collector.io,
      env: { DD_SERVER_PORT: '3000' },
    });
    expect(result).toBe(0);
    expect(collector.out[0]).toBe('server:\n  port: "3000"\n');
  });

  test('stubs a sensitive key as a _file node with a TODO comment, never inlining the value', async () => {
    const sentinel = 'super-secret-sentinel-value-1234';
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export'], {
      io: collector.io,
      env: { DD_REGISTRY_GHCR_PRIVATE_TOKEN: sentinel },
    });
    expect(result).toBe(0);
    const text = collector.out[0];
    expect(text).not.toContain(sentinel);
    expect(text).toContain('_file:');
    expect(text).toContain('# TODO');
    expect(text).toContain('registry:');
  });

  test('carries an existing __FILE marker through as a literal _file node (already a path, not a secret)', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export'], {
      io: collector.io,
      env: { DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE: '/run/secrets/ghcr' },
    });
    expect(result).toBe(0);
    const text = collector.out[0];
    expect(text).toContain('_file: /run/secrets/ghcr');
    expect(text).not.toContain('# TODO');
  });

  test('a degenerate "DD_" key with no segments after the prefix is skipped silently', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export'], {
      io: collector.io,
      env: { DD_: 'nothing-to-nest-under', DD_SERVER_PORT: '3000' },
    });
    expect(result).toBe(0);
    expect(collector.out[0]).toBe('server:\n  port: "3000"\n');
  });

  test('a key whose YAML path collides with another key is skipped with a warning, not a crash', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export'], {
      io: collector.io,
      env: { DD_A: 'scalar', DD_A_B: 'nested' },
    });
    expect(result).toBe(0);
    expect(collector.err.join('\n')).toContain('Skipping');
  });

  test('--out writes the file instead of printing it, mode 0600, and confirms the path', async () => {
    const tempDir = makeTempDir('drydock-export-out-');
    const outPath = path.join(tempDir, 'exported.yml');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export', '--out', outPath], {
      io: collector.io,
      env: { DD_SERVER_PORT: '3000' },
    });
    expect(result).toBe(0);
    expect(collector.out).toStrictEqual([`Wrote ${outPath}`]);
    const written = fs.readFileSync(outPath, 'utf-8');
    expect(written).toBe('server:\n  port: "3000"\n');
    expect(fs.statSync(outPath).mode & 0o777).toBe(0o600);
  });

  test('--out relative to a supplied cwd', async () => {
    const tempDir = makeTempDir('drydock-export-cwd-');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(
      ['config', 'export', '--out', 'exported.yml'],
      { io: collector.io, cwd: tempDir, env: { DD_SERVER_PORT: '3000' } },
    );
    expect(result).toBe(0);
    expect(fs.existsSync(path.join(tempDir, 'exported.yml'))).toBe(true);
  });

  test('a write failure (target directory missing) is reported and exits 1', async () => {
    const tempDir = makeTempDir('drydock-export-fail-');
    const outPath = path.join(tempDir, 'nope', 'exported.yml');
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export', '--out', outPath], {
      io: collector.io,
      env: { DD_SERVER_PORT: '3000' },
    });
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('failed to write');
  });

  test('a whitespace-only --out value fails to resolve and is reported, not thrown', async () => {
    const collector = createIoCollector();
    const result = await runConfigCommandIfRequested(['config', 'export', '--out', '   '], {
      io: collector.io,
      env: { DD_SERVER_PORT: '3000' },
    });
    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('Error:');
    expect(collector.out).toStrictEqual([]);
  });

  test('round trip: export accepts the same values back through validate, secrets excluded', async () => {
    const tempDir = makeTempDir('drydock-export-roundtrip-');
    const outPath = path.join(tempDir, 'roundtrip.yml');
    const secretSentinel = 'roundtrip-secret-sentinel-value';

    const exportCollector = createIoCollector();
    const exportResult = await runConfigCommandIfRequested(['config', 'export', '--out', outPath], {
      io: exportCollector.io,
      env: {
        DD_SERVER_PORT: '3000',
        DD_REGISTRY_GHCR_PRIVATE_USERNAME: 'scott',
        DD_REGISTRY_GHCR_PRIVATE_TOKEN: secretSentinel,
      },
    });
    expect(exportResult).toBe(0);

    const writtenText = fs.readFileSync(outPath, 'utf-8');
    expect(writtenText).not.toContain(secretSentinel);

    const validateCollector = createIoCollector();
    const validateResult = await runConfigCommandIfRequested(
      ['config', 'validate', '--file', outPath],
      { io: validateCollector.io, env: {} },
    );
    expect(validateCollector.err).toStrictEqual([]);
    expect(validateResult).toBe(0);

    // Non-secret keys round-trip to the exact same value; the secret key
    // does not — it comes back as a __FILE reference, not the original
    // value, which loadConfigFile's own flatten step proves directly.
    const { loadConfigFile } = await import('./file/loader.js');
    const flattened = await loadConfigFile({ DD_CONFIG_FILE: outPath });
    expect(flattened.DD_SERVER_PORT).toBe('3000');
    expect(flattened.DD_REGISTRY_GHCR_PRIVATE_USERNAME).toBe('scott');
    expect(flattened.DD_REGISTRY_GHCR_PRIVATE_TOKEN).toBeUndefined();
    expect(flattened.DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE).toBe('/path/to/secret/file');
  });
});
