import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('composables cleanup', () => {
  it('removes legacy useSorting composable after migrating to preferences sorting', () => {
    const useSortingPath = resolve(process.cwd(), 'src/composables/useSorting.ts');
    expect(existsSync(useSortingPath)).toBe(false);
  });
});
