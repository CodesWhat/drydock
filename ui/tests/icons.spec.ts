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

  it('resolves the eye icon used by the env reveal and password toggles (#1523)', () => {
    for (const ref of Object.values(iconMap.eye)) {
      expect(ref).not.toBe('eye');
      expect(Object.keys(bundle)).toContain(ref);
    }
    expect(iconMap.eye['fa6-solid']).toBe('fa6-solid:eye');
  });

  it('has a resolvable glyph for every icon name the templates toggle between', () => {
    for (const name of ['eye', 'eye-slash']) {
      expect(iconMap[name]).toBeDefined();
    }
  });
});
