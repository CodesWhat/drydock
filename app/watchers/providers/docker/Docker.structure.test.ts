import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// Bumped from 1610 for the ensureRemoteAuthHeaders() call ahead of the
// startup ownership seed in init() (PR #1019 CodeRabbit fix): a remote-auth
// watcher's OIDC token must be refreshed before the seed's own
// listContainers() call, or that call goes out unauthenticated and the seed
// silently records nothing. Best-effort like the seed call itself, so a few
// lines of try/catch and comment come with it.
test('Docker watcher implementation should stay under 1630 lines', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const dockerPath = path.resolve(path.dirname(currentFile), 'Docker.ts');
  const lineCount = fs.readFileSync(dockerPath, 'utf8').split('\n').length;

  expect(lineCount).toBeLessThanOrEqual(1630);
});
