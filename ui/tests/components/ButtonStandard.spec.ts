import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');

const ALLOWED_RAW_BUTTON_FILES = new Set([
  'src/components/AppButton.vue',
  'src/components/AppIconButton.vue',
  'src/components/AppTabBar.vue',
  'src/components/ThemeToggle.vue',
  'src/components/ToggleSwitch.vue',
]);

function collectVueFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectVueFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.vue')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('button standard', () => {
  it('uses AppButton as the shared button primitive across Vue templates', () => {
    const vueFiles = collectVueFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const filePath of vueFiles) {
      const relPath = relative(process.cwd(), filePath).replaceAll('\\', '/');
      if (ALLOWED_RAW_BUTTON_FILES.has(relPath)) {
        continue;
      }

      const source = readFileSync(filePath, 'utf8');
      if (/<button\b/.test(source)) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
