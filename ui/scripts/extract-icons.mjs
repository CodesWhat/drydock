#!/usr/bin/env node
/**
 * Extract only the icon SVG bodies we actually use from the full @iconify-json
 * packages and write a compact JSON bundle that the app imports at runtime.
 *
 * Run: node scripts/extract-icons.mjs
 * Output: src/boot/icon-bundle.json (~15-25 KB vs ~9 MB for full collections)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Parse icons.ts to extract all "prefix:name" references
const iconsTs = readFileSync(join(__dirname, '../src/icons.ts'), 'utf-8');
const iconRefs = new Set();
for (const match of iconsTs.matchAll(/'([a-z0-9-]+:[a-z0-9-]+)'/g)) {
  iconRefs.add(match[1]);
}

console.log(`Found ${iconRefs.size} icon references across all libraries`);

// Group by prefix
const byPrefix = {};
for (const ref of iconRefs) {
  const [prefix, name] = ref.split(':');
  if (!byPrefix[prefix]) byPrefix[prefix] = [];
  byPrefix[prefix].push(name);
}

// Load each collection and extract only the icons we need
const bundle = {};
for (const [prefix, names] of Object.entries(byPrefix)) {
  const pkgName = `@iconify-json/${prefix}`;
  let collection;
  try {
    collection = JSON.parse(readFileSync(require.resolve(`${pkgName}/icons.json`), 'utf-8'));
  } catch {
    console.warn(`  WARNING: ${pkgName} not installed, skipping`);
    continue;
  }

  const width = collection.width ?? 24;
  const height = collection.height ?? 24;
  let found = 0;
  let missing = 0;

  for (const name of names) {
    const iconData = collection.icons[name];
    if (!iconData) {
      console.warn(`  WARNING: ${prefix}:${name} not found in ${pkgName}`);
      missing++;
      continue;
    }
    bundle[`${prefix}:${name}`] = {
      body: iconData.body,
      width: iconData.width ?? width,
      height: iconData.height ?? height,
    };
    found++;
  }
  console.log(`  ${prefix}: ${found} icons extracted${missing ? `, ${missing} missing` : ''}`);
}

const outputPath = join(__dirname, '../src/boot/icon-bundle.json');
const json = JSON.stringify(bundle);
writeFileSync(outputPath, json);

const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
console.log(
  `\nWrote ${Object.keys(bundle).length} icons to src/boot/icon-bundle.json (${sizeKB} KB)`,
);
