import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('vite build configuration', () => {
  it('disables source maps for production builds', () => {
    const configPath = resolve(import.meta.dirname, '../../vite.config.ts');
    const configSource = readFileSync(configPath, 'utf8');

    expect(configSource).toMatch(/sourcemap:\s*false/);
  });
});
