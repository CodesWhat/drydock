#!/usr/bin/env node
/**
 * Copy non-default font CSS + WOFF2 files to public/fonts/ for lazy loading.
 *
 * The default font (IBM Plex Mono) is bundled inline via @import in style.css.
 * All other fonts are served as static assets and loaded on demand by useFont.
 *
 * Run: node scripts/extract-fonts.mjs
 * Output: public/fonts/{font-id}/{weight}.css  (with rewritten url() paths)
 *         public/fonts/{font-id}/files/*.woff2
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const fonts = [
  { id: 'jetbrains-mono', pkg: '@fontsource/jetbrains-mono', weights: [300, 400, 500, 600, 700] },
  {
    id: 'source-code-pro',
    pkg: '@fontsource/source-code-pro',
    weights: [300, 400, 500, 600, 700],
  },
  { id: 'inconsolata', pkg: '@fontsource/inconsolata', weights: [300, 400, 500, 600, 700] },
  { id: 'commit-mono', pkg: '@fontsource/commit-mono', weights: [400] },
  { id: 'comic-mono', pkg: '@fontsource/comic-mono', weights: [400] },
];

const publicFonts = join(__dirname, '../public/fonts');

for (const font of fonts) {
  const fontDir = join(publicFonts, font.id);
  const filesDir = join(fontDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  let pkgDir;
  try {
    const pkgJson = require.resolve(`${font.pkg}/package.json`);
    pkgDir = dirname(pkgJson);
  } catch {
    console.warn(`  WARNING: ${font.pkg} not installed, skipping`);
    continue;
  }

  // Copy WOFF2 files
  const pkgFilesDir = join(pkgDir, 'files');
  if (existsSync(pkgFilesDir)) {
    const woff2Files = readdirSync(pkgFilesDir).filter((f) => f.endsWith('.woff2'));
    for (const wf of woff2Files) {
      cpSync(join(pkgFilesDir, wf), join(filesDir, wf));
    }
    console.log(`  ${font.id}: copied ${woff2Files.length} woff2 files`);
  }

  // Generate per-weight CSS with rewritten paths
  for (const weight of font.weights) {
    const cssFile = join(pkgDir, `${weight}.css`);
    if (!existsSync(cssFile)) {
      console.warn(`  WARNING: ${font.pkg}/${weight}.css not found`);
      continue;
    }
    let css = readFileSync(cssFile, 'utf-8');
    // Rewrite url(./files/xxx.woff2) to url(/fonts/{id}/files/xxx.woff2)
    css = css.replace(/url\(\.\/files\//g, `url(/fonts/${font.id}/files/`);
    writeFileSync(join(fontDir, `${weight}.css`), css);
  }
  console.log(`  ${font.id}: ${font.weights.length} weight CSS files generated`);
}

console.log(`\nFonts written to public/fonts/`);
