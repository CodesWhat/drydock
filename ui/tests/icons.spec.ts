import bundle from '@/boot/icon-bundle.json';
import { iconMap } from '@/icons';

describe('icon bundle consistency', () => {
  it('has a bundled entry for every icon referenced in iconMap', () => {
    const bundleKeys = new Set(Object.keys(bundle));
    const missing: string[] = [];

    for (const [concept, libraries] of Object.entries(iconMap)) {
      for (const [library, ref] of Object.entries(libraries)) {
        if (!bundleKeys.has(ref)) {
          missing.push(`${concept}.${library} -> ${ref}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
