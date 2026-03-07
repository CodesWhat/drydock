import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('vite build configuration', () => {
  it('disables source maps for production builds', () => {
    const configPath = resolve(import.meta.dirname, '../../vite.config.ts');
    const configSource = readFileSync(configPath, 'utf8');

    expect(configSource).toMatch(/sourcemap:\s*false/);
  });

  it('splits framework and icon vendor bundles using manual chunks', () => {
    const configPath = resolve(import.meta.dirname, '../../vite.config.ts');
    const configSource = readFileSync(configPath, 'utf8');

    expect(configSource).toMatch(/manualChunks\s*\(id\)/);
    expect(configSource).toMatch(/return 'framework'/);
    expect(configSource).toMatch(/return 'icons'/);
    expect(configSource).toMatch(/return 'vendor'/);
  });
});
