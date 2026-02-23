import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

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

  test('returns error for unknown arguments', () => {
    const collector = createIoCollector();
    const result = runConfigMigrateCommandIfRequested(['config', 'migrate', '--nope'], {
      io: collector.io,
    });

    expect(result).toBe(1);
    expect(collector.err[0]).toContain('Unknown argument: --nope');
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
});
