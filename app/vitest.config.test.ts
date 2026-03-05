import { describe, expect, test } from 'vitest';
import config from './vitest.config.js';

describe('vitest coverage configuration', () => {
  test('does not exclude implementation files from coverage thresholds', () => {
    const exclude = config.test?.coverage?.exclude ?? [];
    expect(exclude).toEqual([
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.typecheck.ts',
      'vitest.config.ts',
    ]);
  });
});
