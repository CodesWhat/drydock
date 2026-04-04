import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('vitest coverage configuration', () => {
  test('uses the custom coverage provider wrapper and keeps file execution serial', async () => {
    const configSource = await readFile(resolve(process.cwd(), 'vitest.config.ts'), 'utf8');

    expect(configSource).toContain('fileParallelism: false');
    expect(configSource).toContain("provider: 'custom'");
    expect(configSource).toContain("customProviderModule: './vitest.coverage-provider.ts'");
    expect(configSource).toContain("include: ['src/**/*.ts']");
    expect(configSource).toContain(
      "exclude: ['**/*.typecheck.ts', '**/*.d.ts', '**/types/**', '**/node_modules/**']",
    );
    expect(configSource).toContain('lines: 100');
    expect(configSource).toContain('branches: 100');
    expect(configSource).toContain('functions: 100');
    expect(configSource).toContain('statements: 100');
  });
});
