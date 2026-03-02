import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareTsNoCheckSets,
  listCurrentTsNoCheckFiles,
  readAllowlistFile,
} from './ts-nocheck-guard.mjs';

const ALLOWLIST_PATH = resolve(process.cwd(), '.ts-nocheck-allowlist.txt');

function main() {
  try {
    accessSync(ALLOWLIST_PATH, constants.F_OK);
  } catch {
    console.error(`Missing allowlist file: ${ALLOWLIST_PATH}`);
    return 1;
  }

  const allowlist = readAllowlistFile(ALLOWLIST_PATH);
  const current = listCurrentTsNoCheckFiles(process.cwd());
  const comparison = compareTsNoCheckSets({ allowlist, current });

  if (!comparison.ok) {
    console.error('New @ts-nocheck usage is not allowed.');
    console.error('Unexpected files:');
    for (const file of comparison.unexpected) {
      console.error(`- ${file}`);
    }
    return 1;
  }

  if (comparison.retired.length > 0) {
    console.log('Some allowlist entries are no longer needed and can be removed:');
    for (const file of comparison.retired) {
      console.log(`- ${file}`);
    }
  }

  console.log(
    `@ts-nocheck allowlist check passed (${current.length} files currently contain @ts-nocheck).`,
  );
  return 0;
}

process.exit(main());
