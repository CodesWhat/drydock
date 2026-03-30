#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { formatValidationFailure, validateCommitMessage } from './commit-message.mjs';

function main() {
  const commitMessageFile = process.argv[2];

  if (!commitMessageFile) {
    console.error('❌ Missing commit message file argument.');
    console.error('This script must be executed by the git commit-msg hook.');
    return 1;
  }

  let commitMessage = '';
  try {
    commitMessage = readFileSync(commitMessageFile, 'utf8');
  } catch (error) {
    console.error(`❌ Failed to read commit message file: ${commitMessageFile}`);
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const result = validateCommitMessage(commitMessage);
  if (!result.valid) {
    console.error(formatValidationFailure(commitMessage, result.errors));
    return 1;
  }

  return 0;
}

process.exit(main());
