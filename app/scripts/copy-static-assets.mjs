#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceAssets = join(__dirname, '../assets');
const outputAssets = join(__dirname, '../dist/assets');

if (!existsSync(sourceAssets)) {
  console.log('No app/assets directory found, skipping static asset copy.');
  process.exit(0);
}

mkdirSync(join(__dirname, '../dist'), { recursive: true });
rmSync(outputAssets, { recursive: true, force: true });
cpSync(sourceAssets, outputAssets, { recursive: true });

console.log('Copied static assets to dist/assets.');
