import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';

const demoRoot = fileURLToPath(new URL('../..', import.meta.url));
const uiSrc = fileURLToPath(new URL('../../../../ui/src', import.meta.url));

const demoCss = readFileSync(join(demoRoot, 'src/demo.css'), 'utf8');
const viteConfig = readFileSync(join(demoRoot, 'vite.config.ts'), 'utf8');
const demoMain = readFileSync(join(demoRoot, 'src/main.ts'), 'utf8');
const uiStyle = readFileSync(join(uiSrc, 'style.css'), 'utf8');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// Custom text sizes declared in the UI @theme, e.g. 2xs-plus for --text-2xs-plus.
const themeSizes = [...uiStyle.matchAll(/^\s*--text-([a-z0-9-]+):/gm)].map((match) => match[1]);

const uiSource = walk(uiSrc)
  .filter((file) => /\.(vue|ts)$/.test(file) && !file.endsWith('.test.ts'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

// Resolve demo.css's import of the UI stylesheet in memory. The job that runs
// these tests installs apps/demo only, so the UI's own `tailwindcss` and font
// imports can't resolve from ui/src. Tailwind itself is compiled from the demo.
function inlineUiStylesheet(css) {
  const uiImport = /@import\s+["'][^"']*ui\/src\/style\.css["'];?/;
  if (!uiImport.test(css)) {
    return css;
  }
  const withoutFonts = uiStyle.replace(/@import\s+["']@fontsource[^"']*["'];?/g, '');
  return css.replace(uiImport, () => withoutFonts);
}

async function compileDemoCss() {
  const compiler = await compile(inlineUiStylesheet(demoCss), {
    base: join(demoRoot, 'src'),
    onDependency: () => {},
  });
  const candidates = [...new Set(uiSource.split(/[^\w:./%[\]()#,-]+/).filter(Boolean))];
  return compiler.build(candidates);
}

test('demo CSS defines and emits every custom text size the UI uses', async () => {
  assert.ok(themeSizes.includes('2xs-plus'), 'expected the UI @theme to declare --text-2xs-plus');

  const css = await compileDemoCss();

  let checked = 0;
  for (const size of themeSizes) {
    if (!new RegExp(`(?<![\\w-])text-${size}(?![\\w-])`).test(uiSource)) {
      continue;
    }
    checked += 1;
    assert.ok(css.includes(`--text-${size}:`), `--text-${size} is not defined in the demo CSS`);
    assert.ok(
      css.includes(`.text-${size}`) && css.includes(`font-size: var(--text-${size})`),
      `.text-${size} utility is not emitted in the demo CSS`,
    );
  }
  assert.ok(checked >= 4, `expected the UI to use several custom sizes, found ${checked}`);
});

test('demo has one theme source: demo.css wraps the UI stylesheet', () => {
  assert.match(demoCss, /@import\s+["'][^"']*ui\/src\/style\.css["']/);
  assert.doesNotMatch(demoCss, /@import\s+["']tailwindcss["']/);
  assert.match(viteConfig, /'\.\/style\.css'/);
  assert.match(viteConfig, /demoCssPath/);
  assert.doesNotMatch(demoMain, /demo\.css/);
});
