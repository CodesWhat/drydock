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

// Collections rename icons between releases by demoting the old name to an
// alias (lucide 1.2.121 did this to `history`), so a plain icons[] lookup
// silently drops icons the app still references. Follow the alias chain to
// the real icon. Aliases carrying transforms (rotate/flip) can't be expressed
// in this body-only bundle, so refuse those instead of shipping a wrong glyph.
function resolveIcon(collection, name, depth = 0) {
  if (depth > 5) return undefined;
  const icon = collection.icons[name];
  if (icon) return icon;
  const alias = collection.aliases?.[name];
  if (!alias) return undefined;
  if (alias.rotate || alias.hFlip || alias.vFlip) {
    console.warn(`  WARNING: alias ${name} needs a transform this bundle cannot represent`);
    return undefined;
  }
  const parent = resolveIcon(collection, alias.parent, depth + 1);
  if (!parent) return undefined;
  const { parent: _ignored, ...overrides } = alias;
  return { ...parent, ...overrides };
}

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
    const iconData = resolveIcon(collection, name);
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
const json = `${JSON.stringify(bundle, null, 2)}\n`;
writeFileSync(outputPath, json);

const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
console.log(
  `\nWrote ${Object.keys(bundle).length} icons to src/boot/icon-bundle.json (${sizeKB} KB)`,
);
