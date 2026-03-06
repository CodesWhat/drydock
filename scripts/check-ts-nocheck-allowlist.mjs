import { listCurrentTsNoCheckFiles } from './ts-nocheck-guard.mjs';

function main() {
  const current = listCurrentTsNoCheckFiles(process.cwd());

  if (current.length > 0) {
    console.error('@ts-nocheck is not allowed.');
    console.error('Files containing @ts-nocheck:');
    for (const file of current) {
      console.error(`- ${file}`);
    }
    return 1;
  }

  console.log('@ts-nocheck check passed (0 files contain @ts-nocheck).');
  return 0;
}

process.exit(main());
