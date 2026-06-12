#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from './lib/parse-args.mjs';

// Stable, invisible marker embedded in UPGRADE-NOTES.md. Presence of this string
// in the assembled release notes means the block is already there, so we never
// append it twice (e.g. when a CHANGELOG section also inlines the note).
export const UPGRADE_NOTES_MARKER = 'upgrade-notes-marker';

function normalizeVersion(version) {
  return String(version ?? '')
    .trim()
    .replace(/^v/u, '');
}

/**
 * The upgrade notes cover the security-hardening behavioral changes introduced
 * in 1.4.6 and carried through the 1.5 line. They apply to 1.4.6+ on the 1.4.x
 * line and to every 1.5.x release (including release candidates such as
 * `1.5.0-rc.36`). They do not apply to 1.4.0–1.4.5 (pre-change) or to 1.6+
 * (where the behavior is long-standing and documented as the default).
 */
export function appliesToVersion(version) {
  const core = normalizeVersion(version).split('-')[0];
  const [major, minor, patch] = core.split('.').map((part) => Number.parseInt(part, 10));
  if (major !== 1) {
    return false;
  }
  if (minor === 5) {
    return true;
  }
  return minor === 4 && patch >= 6;
}

/**
 * Append the upgrade-notes block to release notes, unless it does not apply to
 * this version or the notes already contain the marker. Pure — returns the new
 * notes string and never mutates its inputs.
 */
export function appendUpgradeNotes(notesContent, upgradeContent, version) {
  const notes = String(notesContent ?? '');
  const upgrade = String(upgradeContent ?? '').trim();
  if (!upgrade || !appliesToVersion(version)) {
    return notes;
  }
  if (notes.includes(UPGRADE_NOTES_MARKER)) {
    return notes;
  }
  return `${notes.replace(/\s+$/u, '')}\n\n${upgrade}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { version, notes } = args;
  const upgradeFile = args.file ?? 'UPGRADE-NOTES.md';

  if (!version) {
    throw new Error('--version is required');
  }
  if (!notes) {
    throw new Error('--notes is required');
  }

  let upgradeContent = '';
  try {
    upgradeContent = readFileSync(upgradeFile, 'utf8');
  } catch {
    // No upgrade-notes file for this line — nothing to append, not an error.
    return;
  }

  const original = readFileSync(notes, 'utf8');
  const updated = appendUpgradeNotes(original, upgradeContent, version);
  if (updated !== original) {
    writeFileSync(notes, updated);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
