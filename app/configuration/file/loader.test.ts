import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from '../../log/index.js';
import { getConfigFileLayer, resetConfigFileLayer } from './layer.js';
import { loadConfigFile, loadConfigFileIntoLayer } from './loader.js';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir: string, name: string, contents: string, mode = 0o600): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents, 'utf-8');
  fs.chmodSync(filePath, mode);
  return filePath;
}

/** Points loadConfigFile's default discovery at paths inside a scratch dir. */
function defaultPathsIn(dir: string): readonly [string, string] {
  return [path.join(dir, 'drydock.yml'), path.join(dir, 'drydock.yaml')];
}

describe('loadConfigFile', () => {
  describe('discovery', () => {
    test('returns {} silently when the default path is absent', async () => {
      const tempDir = makeTempDir('drydock-config-absent-');
      try {
        await expect(
          loadConfigFile({}, { defaultPaths: defaultPathsIn(tempDir) }),
        ).resolves.toStrictEqual({});
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('loads from the default .yml path when present', async () => {
      const tempDir = makeTempDir('drydock-config-yml-');
      try {
        writeFile(tempDir, 'drydock.yml', 'server:\n  port: 4000\n');
        const result = await loadConfigFile({}, { defaultPaths: defaultPathsIn(tempDir) });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '4000' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('loads from the default .yaml path when present', async () => {
      const tempDir = makeTempDir('drydock-config-yaml-');
      try {
        writeFile(tempDir, 'drydock.yaml', 'server:\n  port: 4001\n');
        const result = await loadConfigFile({}, { defaultPaths: defaultPathsIn(tempDir) });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '4001' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('throws when both .yml and .yaml exist at the default path', async () => {
      const tempDir = makeTempDir('drydock-config-both-');
      try {
        writeFile(tempDir, 'drydock.yml', 'server:\n  port: 4000\n');
        writeFile(tempDir, 'drydock.yaml', 'server:\n  port: 4001\n');
        await expect(loadConfigFile({}, { defaultPaths: defaultPathsIn(tempDir) })).rejects.toThrow(
          /exist; remove one/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('DD_CONFIG_FILE set and absent is fatal, naming the path', async () => {
      const tempDir = makeTempDir('drydock-config-override-absent-');
      const missingPath = path.join(tempDir, 'nope.yml');
      try {
        await expect(loadConfigFile({ DD_CONFIG_FILE: missingPath })).rejects.toThrow(
          new RegExp(`DD_CONFIG_FILE points at "${missingPath.replace(/[/\\]/g, '\\$&')}"`),
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('propagates a stat failure that is not ENOENT (e.g. a path beneath a regular file)', async () => {
      const tempDir = makeTempDir('drydock-config-enotdir-');
      // A default path whose parent is a regular file makes stat fail with
      // ENOTDIR, a real non-ENOENT error with no spy on the fs module.
      const notADirectory = writeFile(tempDir, 'notadir', 'x\n');
      const filePath = path.join(notADirectory, 'drydock.yml');
      try {
        await expect(
          loadConfigFile({}, { defaultPaths: [filePath, path.join(tempDir, 'drydock.yaml')] }),
        ).rejects.toThrow(/ENOTDIR/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('DD_CONFIG_FILE takes precedence over a present default path', async () => {
      const tempDir = makeTempDir('drydock-config-override-wins-');
      try {
        writeFile(tempDir, 'drydock.yml', 'server:\n  port: 4000\n');
        const overridePath = writeFile(tempDir, 'custom.yml', 'server:\n  port: 5000\n');
        const result = await loadConfigFile(
          { DD_CONFIG_FILE: overridePath },
          { defaultPaths: defaultPathsIn(tempDir) },
        );
        expect(result).toStrictEqual({ DD_SERVER_PORT: '5000' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('resolves a relative DD_CONFIG_FILE against the current working directory', async () => {
      const tempDir = makeTempDir('drydock-config-relative-');
      const originalCwd = process.cwd();
      try {
        writeFile(tempDir, 'drydock.yml', 'server:\n  port: 4002\n');
        process.chdir(tempDir);
        const result = await loadConfigFile({ DD_CONFIG_FILE: 'drydock.yml' });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '4002' });
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('file hardening', () => {
    test('rejects a non-regular file (a directory) at DD_CONFIG_FILE', async () => {
      const tempDir = makeTempDir('drydock-config-dir-');
      try {
        await expect(loadConfigFile({ DD_CONFIG_FILE: tempDir })).rejects.toThrow(
          /must be a regular file/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('rejects a file over the size cap', async () => {
      const tempDir = makeTempDir('drydock-config-toolarge-');
      try {
        const oversizedPath = writeFile(tempDir, 'big.yml', `# ${'x'.repeat(1024 * 1024)}\n`);
        await expect(loadConfigFile({ DD_CONFIG_FILE: oversizedPath })).rejects.toThrow(
          /exceeds maximum size/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('accepts a file exactly at the size cap', async () => {
      const tempDir = makeTempDir('drydock-config-exact-');
      try {
        // "dnsMode: <padding>" padded with a YAML comment out to exactly 1 MiB.
        const prefix = 'dnsMode: hostgateway\n#';
        const padded = prefix + 'x'.repeat(1024 * 1024 - prefix.length);
        const exactPath = writeFile(tempDir, 'exact.yml', padded);
        expect(fs.statSync(exactPath).size).toBe(1024 * 1024);
        const result = await loadConfigFile({ DD_CONFIG_FILE: exactPath });
        expect(result).toStrictEqual({ DD_DNSMODE: 'hostgateway' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('is fatal when the config file is world-writable', async () => {
      const tempDir = makeTempDir('drydock-config-worldwritable-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n', 0o666);
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /is group- or world-writable/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('is fatal when the config file is group-writable', async () => {
      const tempDir = makeTempDir('drydock-config-groupwritable-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n', 0o620);
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /is group- or world-writable/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('warns, matching replaceSecrets’s message shape, when the config file is group-or-other readable', async () => {
      const tempDir = makeTempDir('drydock-config-grouponly-');
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n', 0o644);
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '3000' });
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Config file "${filePath}" is readable by group or others`),
        );
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`chmod 600 "${filePath}"`));
      } finally {
        warnSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('warns when the config file is group-readable only (0640)', async () => {
      const tempDir = makeTempDir('drydock-config-groupreadable-');
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n', 0o640);
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '3000' });
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Config file "${filePath}" is readable by group or others`),
        );
      } finally {
        warnSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('does not warn for a 0600 config file', async () => {
      const tempDir = makeTempDir('drydock-config-0600-');
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n', 0o600);
        await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('skips the permission check entirely on non-POSIX platforms (win32)', async () => {
      const tempDir = makeTempDir('drydock-config-win32-');
      const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
      const platformSpy = vi.spyOn(os, 'platform').mockReturnValue('win32' as NodeJS.Platform);
      try {
        // World-writable by POSIX bits, which would otherwise be fatal.
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n', 0o666);
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '3000' });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        platformSpy.mockRestore();
        warnSpy.mockRestore();
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('parse hardening', () => {
    test('rejects a duplicate key', async () => {
      const tempDir = makeTempDir('drydock-config-dupkey-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'server:\n  port: 1\nserver:\n  port: 2\n',
        );
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /not valid YAML/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('does not honour a "<<" merge key, and the unrendered marker fails key validation', async () => {
      const tempDir = makeTempDir('drydock-config-mergekey-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'base: &base\n  x: 1\nfoo:\n  <<: *base\n  y: 2\n',
        );
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /key "<<" must match/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('bounds an alias-expansion bomb', async () => {
      const tempDir = makeTempDir('drydock-config-aliasbomb-');
      try {
        const lines = ['a1: &a1 "x"'];
        for (let level = 2; level <= 20; level += 1) {
          lines.push(`a${level}: &a${level}`);
          lines.push(`  p: *a${level - 1}`);
          lines.push(`  q: *a${level - 1}`);
          lines.push(`  r: *a${level - 1}`);
        }
        const filePath = writeFile(tempDir, 'drydock.yml', lines.join('\n'));
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /not valid YAML/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test.each([
      ['a scalar document', 'just-a-string\n'],
      ['a sequence document', '- a\n- b\n'],
      ['a null document', '\n'],
    ])('rejects %s as the root', async (_label, contents) => {
      const tempDir = makeTempDir('drydock-config-badroot-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', contents);
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /document root must be a mapping/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('rejects a sequence value nested under a mapping', async () => {
      const tempDir = makeTempDir('drydock-config-seqval-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'security:\n  blockSeverity:\n    - CRITICAL\n    - HIGH\n',
        );
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /sequence values are not supported/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('rejects a key outside the ^[A-Za-z0-9_]+$ charset', async () => {
      const tempDir = makeTempDir('drydock-config-badkey-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server-port: 3000\n');
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /key "server-port" must match/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('rejects __proto__ as a key outright', async () => {
      const tempDir = makeTempDir('drydock-config-proto-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', '__proto__:\n  polluted: true\n');
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /reserved key name/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('normalises keys case-insensitively to lowercase before flattening', async () => {
      const tempDir = makeTempDir('drydock-config-casing-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'watcher:\n  local:\n    maintenanceWindowTz: UTC\n',
        );
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({ DD_WATCHER_LOCAL_MAINTENANCEWINDOWTZ: 'UTC' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('treats a null value as unset', async () => {
      const tempDir = makeTempDir('drydock-config-nullval-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n  name: null\n');
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({ DD_SERVER_PORT: '3000' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('coerces booleans and numbers to their string form', async () => {
      const tempDir = makeTempDir('drydock-config-coerce-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'action:\n  docker:\n    local:\n      prune: true\nserver:\n  port: 3000\n',
        );
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({
          DD_ACTION_DOCKER_LOCAL_PRUNE: 'true',
          DD_SERVER_PORT: '3000',
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('flattens a _file node to the __FILE-suffixed key', async () => {
      const tempDir = makeTempDir('drydock-config-secretfile-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'registry:\n  ghcr:\n    private:\n      token:\n        _file: /run/secrets/ghcr\n',
        );
        const result = await loadConfigFile({ DD_CONFIG_FILE: filePath });
        expect(result).toStrictEqual({
          DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE: '/run/secrets/ghcr',
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('rejects a _file node whose base key is also set in the same file', async () => {
      const tempDir = makeTempDir('drydock-config-secretcollide-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          [
            'registry:',
            '  ghcr:',
            '    private:',
            '      token:',
            '        _file: /run/secrets/ghcr',
            'registry_ghcr_private_token: literal-value',
            '',
          ].join('\n'),
        );
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          /sets DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE as a secret file/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('wraps a YAML syntax error with the file path', async () => {
      const tempDir = makeTempDir('drydock-config-syntax-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: [1, 2\n');
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          new RegExp(`Config file "${filePath.replace(/[/\\]/g, '\\$&')}" is not valid YAML`),
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('${NAME} interpolation (spec-7.1-config-file.md decision D1)', () => {
    test('substitutes ${NAME} in the flattened result', async () => {
      const tempDir = makeTempDir('drydock-config-interp-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  name: ${SERVER_NAME}\n');
        const result = await loadConfigFile({
          DD_CONFIG_FILE: filePath,
          SERVER_NAME: 'from-env',
        });
        expect(result).toStrictEqual({ DD_SERVER_NAME: 'from-env' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('populates the interpolatedKeys out-param when provided', async () => {
      const tempDir = makeTempDir('drydock-config-interp-keys-');
      try {
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          'server:\n  name: ${SERVER_NAME}\n  port: 3000\n',
        );
        const interpolatedKeys = new Set<string>();
        const result = await loadConfigFile(
          { DD_CONFIG_FILE: filePath, SERVER_NAME: 'from-env' },
          { interpolatedKeys },
        );
        expect(result).toStrictEqual({ DD_SERVER_NAME: 'from-env', DD_SERVER_PORT: '3000' });
        expect(interpolatedKeys).toStrictEqual(new Set(['DD_SERVER_NAME']));
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('leaves interpolatedKeys empty when the file has no ${NAME} references', async () => {
      const tempDir = makeTempDir('drydock-config-interp-empty-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  port: 3000\n');
        const interpolatedKeys = new Set<string>();
        await loadConfigFile({ DD_CONFIG_FILE: filePath }, { interpolatedKeys });
        expect(interpolatedKeys.size).toBe(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('an unset variable with no default is fatal, wrapped with the file path', async () => {
      const tempDir = makeTempDir('drydock-config-interp-unset-');
      try {
        const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  name: ${MISSING_VAR}\n');
        await expect(loadConfigFile({ DD_CONFIG_FILE: filePath })).rejects.toThrow(
          new RegExp(
            `Config file "${filePath.replace(/[/\\]/g, '\\$&')}": server.name.*MISSING_VAR`,
            's',
          ),
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('a _file node’s path can itself be interpolated, without touching the referenced file’s contents', async () => {
      const tempDir = makeTempDir('drydock-config-interp-secretfile-');
      try {
        const secretPath = writeFile(tempDir, 'ghcr-secret', 'super-secret-value\n');
        const filePath = writeFile(
          tempDir,
          'drydock.yml',
          [
            'registry:',
            '  ghcr:',
            '    private:',
            '      token:',
            '        _file: ${GHCR_SECRET_PATH}',
            '',
          ].join('\n'),
        );
        const result = await loadConfigFile({
          DD_CONFIG_FILE: filePath,
          GHCR_SECRET_PATH: secretPath,
        });
        // loadConfigFile only flattens the tree; it never reads the target
        // of a `_file` node (that's replaceSecrets's job, later in
        // ../index.ts's pipeline), so the result names the path verbatim.
        expect(result).toStrictEqual({ DD_REGISTRY_GHCR_PRIVATE_TOKEN__FILE: secretPath });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

describe('loadConfigFileIntoLayer', () => {
  afterEach(() => {
    resetConfigFileLayer();
  });

  test('loads the file and publishes the result to file/layer.ts', async () => {
    const tempDir = makeTempDir('drydock-config-into-layer-');
    try {
      const filePath = writeFile(tempDir, 'drydock.yml', 'server:\n  name: from-file\n');
      await loadConfigFileIntoLayer({ DD_CONFIG_FILE: filePath });
      expect(getConfigFileLayer()).toStrictEqual({ DD_SERVER_NAME: 'from-file' });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('with no config file present, publishes an empty layer', async () => {
    const tempDir = makeTempDir('drydock-config-into-layer-absent-');
    try {
      await loadConfigFileIntoLayer({}, { defaultPaths: defaultPathsIn(tempDir) });
      expect(getConfigFileLayer()).toStrictEqual({});
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('a load failure rejects and never publishes a layer', async () => {
    const tempDir = makeTempDir('drydock-config-into-layer-missing-');
    const missingPath = path.join(tempDir, 'missing.yml');
    try {
      await expect(loadConfigFileIntoLayer({ DD_CONFIG_FILE: missingPath })).rejects.toThrow(
        new RegExp(`DD_CONFIG_FILE points at "${missingPath.replace(/[/\\]/g, '\\$&')}"`),
      );
      expect(getConfigFileLayer()).toStrictEqual({});
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
