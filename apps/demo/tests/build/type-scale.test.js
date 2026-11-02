import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const demoRoot = fileURLToPath(new URL('../..', import.meta.url));
const uiSrc = fileURLToPath(new URL('../../../../ui/src', import.meta.url));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// Custom text sizes declared in the UI @theme, e.g. 2xs-plus for --text-2xs-plus.
const themeSizes = [
  ...readFileSync(join(uiSrc, 'style.css'), 'utf8').matchAll(/^\s*--text-([a-z0-9-]+):/gm),
].map((match) => match[1]);

const uiSource = walk(uiSrc)
  .filter((file) => /\.(vue|ts)$/.test(file) && !file.endsWith('.test.ts'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

test('demo CSS defines and emits every custom text size the UI uses', () => {
  assert.ok(themeSizes.includes('2xs-plus'), 'expected the UI @theme to declare --text-2xs-plus');

  const outDir = mkdtempSync(join(tmpdir(), 'drydock-demo-css-'));
  try {
    execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: demoRoot,
      stdio: 'pipe',
    });
    const assets = join(outDir, 'assets');
    const css = readdirSync(assets)
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFileSync(join(assets, file), 'utf8'))
      .join('\n');

    let checked = 0;
    for (const size of themeSizes) {
      if (!new RegExp(`(?<![\\w-])text-${size}(?![\\w-])`).test(uiSource)) {
        continue;
      }
      checked += 1;
      assert.ok(css.includes(`--text-${size}:`), `--text-${size} is not defined in the demo CSS`);
      assert.ok(
        css.includes(`.text-${size}{font-size:var(--text-${size})`),
        `.text-${size} utility is not emitted in the demo CSS`,
      );
    }
    assert.ok(checked >= 4, `expected the UI to use several custom sizes, found ${checked}`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
