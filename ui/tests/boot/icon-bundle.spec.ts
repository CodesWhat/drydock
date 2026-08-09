import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The bundle is regenerated from the locked @iconify-json packages at image
// build time, so a reference that only resolves against some other installed
// version ships as a blank icon. lucide 1.2.121 turned `history` into an
// alias, which the extractor used to drop silently — this pins every
// reference in icons.ts to an entry the extractor actually emitted.
describe('icon bundle', () => {
  it('contains every icon referenced in icons.ts', () => {
    const iconsTs = readFileSync(resolve(process.cwd(), 'src/icons.ts'), 'utf-8');
    const bundle = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src/boot/icon-bundle.json'), 'utf-8'),
    ) as Record<string, { body: string }>;

    const refs = [...iconsTs.matchAll(/'([a-z0-9-]+:[a-z0-9-]+)'/gu)].map((match) => match[1]);
    expect(refs.length).toBeGreaterThan(0);

    const missing = refs.filter((ref) => !bundle[ref]?.body);
    expect(missing).toEqual([]);
  });
});
