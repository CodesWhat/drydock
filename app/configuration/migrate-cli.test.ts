import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { migrateLegacyConfigContent, runConfigMigrateCommandIfRequested } from './migrate-cli.js';

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

function withTempDir(run: (tempDir: string) => void) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-migrate-'));
  try {
    run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('migrateLegacyConfigContent', () => {
  test('migrates known WUD env vars and labels to drydock prefixes', () => {
    const content = `
WUD_SERVER_PORT=3000
export WUD_SERVER_HOST=0.0.0.0
  - WUD_WATCHER_LOCAL_PORT=2375
WUD_WATCHER_LOCAL_HOST: socket-proxy
labels:
  - wud.watch=true
  - "wud.tag.include=^v"
  wud.display.name: my-app
  wud.compose.file: /opt/wud-compose.yml
`;

    const migrated = migrateLegacyConfigContent(content);

    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    expect(migrated.content).toContain('export DD_SERVER_HOST=0.0.0.0');
    expect(migrated.content).toContain('- DD_WATCHER_LOCAL_PORT=2375');
    expect(migrated.content).toContain('DD_WATCHER_LOCAL_HOST: socket-proxy');
    expect(migrated.content).toContain('dd.watch=true');
    expect(migrated.content).toContain('"dd.tag.include=^v"');
    expect(migrated.content).toContain('dd.display.name: my-app');
    expect(migrated.content).toContain('dd.compose.file: /opt/wud-compose.yml');
    expect(migrated.envReplacements).toBe(4);
    expect(migrated.labelReplacements).toBe(4);
  });

  test('migrates watchtower labels when source is watchtower', () => {
    const content = `
services:
  app:
    labels:
      - com.centurylinklabs.watchtower.enable=true
      com.centurylinklabs.watchtower.enable: "false"
`;

    const migrated = migrateLegacyConfigContent(content, 'watchtower');

    expect(migrated.content).toContain('- dd.watch=true');
    expect(migrated.content).toContain('dd.watch: "false"');
    expect(migrated.envReplacements).toBe(0);
    expect(migrated.labelReplacements).toBe(2);
  });

  test('auto source migrates both wud and watchtower patterns', () => {
    const content = `
WUD_SERVER_PORT=3000
labels:
  - wud.watch=true
  - com.centurylinklabs.watchtower.enable=false
`;

    const migrated = migrateLegacyConfigContent(content, 'auto');

    expect(migrated.content).toContain('DD_SERVER_PORT=3000');
    expect(migrated.content).toContain('dd.watch=true');
    expect(migrated.content).toContain('dd.watch=false');
    expect(migrated.envReplacements).toBe(1);
    expect(migrated.labelReplacements).toBe(2);
  });

  test('avoids partial label matches', () => {
    const content = `
labels:
  - wud.watch=false
  - wud.watcher=true
  - com.centurylinklabs.watchtower.enable=true
  - com.centurylinklabs.watchtower.enabled=true
  - prefixwud.watch=true
`;

    const migrated = migrateLegacyConfigContent(content, 'auto');

    expect(migrated.content).toContain('- dd.watch=false');
    expect(migrated.content).toContain('- dd.watch=true');
    expect(migrated.content).toContain('- wud.watcher=true');
    expect(migrated.content).toContain('- com.centurylinklabs.watchtower.enabled=true');
    expect(migrated.content).toContain('- prefixwud.watch=true');
    expect(migrated.labelReplacements).toBe(2);
  });

  test('does not construct label regex patterns during migration passes', () => {
    const content = `
labels:
  - wud.watch=true
  - com.centurylinklabs.watchtower.enable=false
`;
    const originalRegExp = globalThis.RegExp;
    let constructorCalls = 0;
    const countingRegExp = function (
      this: RegExp,
      pattern?: string | RegExp,
      flags?: string,
    ) {
      constructorCalls += 1;
      return new originalRegExp(pattern, flags);
    } as unknown as RegExpConstructor;
    Object.setPrototypeOf(countingRegExp, originalRegExp);
    countingRegExp.prototype = originalRegExp.prototype;
    (globalThis as { RegExp: RegExpConstructor }).RegExp = countingRegExp;

    try {
      migrateLegacyConfigContent(content, 'auto');
    } finally {
      (globalThis as { RegExp: RegExpConstructor }).RegExp = originalRegExp;
    }

    expect(constructorCalls).toBe(0);
  });
});

describe('runConfigMigrateCommandIfRequested', () => {
  test('returns null when argv does not match config migrate command', () => {
    const result = runConfigMigrateCommandIfRequested(['--agent']);
    expect(result).toBeNull();
  });

  test('supports --help output', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--help'], {
      io: collector.io,
    });

    expect(result).toBe(0);
    expect(collector.out.join('\n')).toContain('Usage: drydock config migrate');
    expect(collector.err).toEqual([]);
  });

  test('supports -h short help flag', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '-h'], {
      io: collector.io,
    });

    expect(result).toBe(0);
    expect(collector.out.join('\n')).toContain('Usage: drydock config migrate');
    expect(collector.err).toEqual([]);
  });

  test('returns error for unknown arguments', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--nope'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err[0]).toContain('Unknown argument: --nope');
  });

  test('returns error when --file is missing a value', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('--file requires a path value');
  });

  test('returns error when --source is missing a value', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--source'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err.join('\n')).toContain('--source requires a value');
  });

  test('returns error for unsupported migration source', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(
      ['config', 'migrate', '--source', 'invalid'],
      {
        io: collector.io,
      },
    );

    expect(result).toBe(1);
    expect(collector.err[0]).toContain('Unsupported source');
  });

  test('reports when no candidate config files exist', () => {
    withTempDir((tempDir) => {
      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
    });
  });

  test('reports explicitly requested missing files', () => {
    withTempDir((tempDir) => {
      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', 'missing.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
      expect(collector.out.join('\n')).toContain('Checked files: missing.env');
    });
  });

  test('rejects --file paths that escape the current working directory', () => {
    withTempDir((tempDir) => {
      const workspaceDir = path.join(tempDir, 'workspace');
      const outsidePath = path.join(tempDir, 'outside.env');
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(outsidePath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '../outside.env'],
        {
          cwd: workspaceDir,
          io: collector.io,
        },
      );

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('must stay inside');
      expect(fs.readFileSync(outsidePath, 'utf-8')).toBe('WUD_SERVER_HOST=localhost\n');
    });
  });

  test('rejects absolute --file paths', () => {
    withTempDir((tempDir) => {
      const absolutePath = path.join(tempDir, '.env');
      fs.writeFileSync(absolutePath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', absolutePath],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('must be a relative path');
      expect(fs.readFileSync(absolutePath, 'utf-8')).toBe('WUD_SERVER_HOST=localhost\n');
    });
  });

  test('supports dry-run without modifying files', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      const original = 'WUD_SERVER_HOST=localhost\n';
      fs.writeFileSync(envPath, original, 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--dry-run', '--file', '.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toBe(original);
      expect(collector.out.join('\n')).toContain('DRY-RUN');
      expect(collector.out.join('\n')).toContain('Dry-run mode: no files were modified.');
    });
  });

  test('treats empty files as unchanged and reports summary', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, '', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(fs.readFileSync(envPath, 'utf-8')).toBe('');
      expect(collector.out.join('\n')).toContain(`UNCHANGED ${envPath}`);
      expect(collector.out.join('\n')).toContain(
        'Summary: scanned=1, updated=0, missing=0, env_rewrites=0, label_rewrites=0',
      );
    });
  });

  test('prints resolved file path in UNCHANGED output', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'DD_SERVER_HOST=localhost\n', 'utf-8');

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      expect(result).toBe(0);
      expect(collector.out.join('\n')).toContain(`UNCHANGED ${envPath}`);
    });
  });

  test('rejects symlinked config files', () => {
    withTempDir((tempDir) => {
      const sourcePath = path.join(tempDir, '.env.source');
      const symlinkPath = path.join(tempDir, '.env');
      const original = 'WUD_SERVER_HOST=localhost\n';
      fs.writeFileSync(sourcePath, original, 'utf-8');
      fs.symlinkSync(sourcePath, symlinkPath);

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', '.env'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      expect(result).toBe(0);
      expect(fs.readFileSync(sourcePath, 'utf-8')).toBe(original);
      expect(collector.err.join('\n')).toContain('Refusing to process symlink');
      expect(collector.out.join('\n')).toContain('No config files found to migrate.');
    });
  });

  test('writes migrated content in normal mode', () => {
    withTempDir((tempDir) => {
      const composePath = path.join(tempDir, 'compose.yaml');
      fs.writeFileSync(
        composePath,
        [
          'services:',
          '  app:',
          '    environment:',
          '      WUD_SERVER_HOST: localhost',
          '    labels:',
          '      - wud.watch=true',
          '',
        ].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--file', 'compose.yaml'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      const migrated = fs.readFileSync(composePath, 'utf-8');
      expect(result).toBe(0);
      expect(migrated).toContain('DD_SERVER_HOST: localhost');
      expect(migrated).toContain('dd.watch=true');
      expect(collector.out.join('\n')).toContain('UPDATED');
    });
  });

  test('supports watchtower-only migration source', () => {
    withTempDir((tempDir) => {
      const composePath = path.join(tempDir, 'compose.yaml');
      fs.writeFileSync(
        composePath,
        [
          'services:',
          '  app:',
          '    environment:',
          '      WUD_SERVER_HOST: localhost',
          '    labels:',
          '      - com.centurylinklabs.watchtower.enable=true',
          '',
        ].join('\n'),
        'utf-8',
      );

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(
        ['config', 'migrate', '--source', 'watchtower', '--file', 'compose.yaml'],
        {
          cwd: tempDir,
          io: collector.io,
        },
      );

      const migrated = fs.readFileSync(composePath, 'utf-8');
      expect(result).toBe(0);
      expect(migrated).toContain('WUD_SERVER_HOST: localhost');
      expect(migrated).toContain('dd.watch=true');
      expect(collector.out.join('\n')).toContain('UPDATED');
    });
  });

  test('returns a user-friendly error when reading a file fails', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        const error = new Error('permission denied');
        (error as NodeJS.ErrnoException).code = 'EACCES';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      readSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to read');
      expect(collector.err.join('\n')).toContain(envPath);
      expect(collector.err.join('\n')).toContain('permission denied');
    });
  });

  test('returns a user-friendly error when writing a file fails', () => {
    withTempDir((tempDir) => {
      const envPath = path.join(tempDir, '.env');
      fs.writeFileSync(envPath, 'WUD_SERVER_HOST=localhost\n', 'utf-8');

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
        const error = new Error('no space left on device');
        (error as NodeJS.ErrnoException).code = 'ENOSPC';
        throw error;
      });

      const collector = createIoCollector();
      const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--file', '.env'], {
        cwd: tempDir,
        io: collector.io,
      });

      writeSpy.mockRestore();

      expect(result).toBe(1);
      expect(collector.err.join('\n')).toContain('Failed to write');
      expect(collector.err.join('\n')).toContain(envPath);
      expect(collector.err.join('\n')).toContain('no space left on device');
    });
  });
});
