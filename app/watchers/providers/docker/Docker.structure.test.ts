import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// Bumped from 1600 for the seedControllerLocalEnumeration call in init()
// (DR-106 addendum): one awaited call plus its comment, closing the window
// where an agent handshake can race the first scheduled enumeration. The
// seed function itself lives in controller-local-container-ids.ts.
test('Docker watcher implementation should stay under 1610 lines', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const dockerPath = path.resolve(path.dirname(currentFile), 'Docker.ts');
  const lineCount = fs.readFileSync(dockerPath, 'utf8').split('\n').length;

  expect(lineCount).toBeLessThanOrEqual(1610);
});
