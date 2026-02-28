import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const filesToCheck = [
  'src/views/AgentsView.vue',
  'src/views/ContainersView.vue',
  'src/layouts/AppLayout.vue',
  'src/style.css',
];

const disallowedPatterns = [
  /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/g,
  /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/g,
];

describe('theme-safe overlays', () => {
  it.each(filesToCheck)('avoids hardcoded black/white rgba overlays in %s', (filePath) => {
    const source = readFileSync(resolve(process.cwd(), filePath), 'utf8');

    for (const pattern of disallowedPatterns) {
      const matches = source.match(pattern) ?? [];
      expect(matches).toHaveLength(0);
    }
  });
});
