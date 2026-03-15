import { describe, expect, test } from 'vitest';
import config from './vitest.config.js';

describe('vitest coverage configuration', () => {
  test('coverage excludes only infrastructure and declaration files', () => {
    const exclude = config.test?.coverage?.exclude ?? [];
    expect(exclude).toEqual([
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/package.json',
      '**/*.d.ts',
      '**/*.typecheck.ts',
      'vitest.config.ts',
      'vitest.coverage-provider.ts',
    ]);
  });
});
