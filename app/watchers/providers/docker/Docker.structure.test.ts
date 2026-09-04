import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// Bumped from 1610 to 1630 for the ensureRemoteAuthHeaders() call ahead of
// the startup ownership seed in init() (PR #1019 CodeRabbit fix), then to
// 1690 for wouldRefreshRequireInteractiveOidcDeviceFlow(): init() must not
// await a first-time interactive OIDC device-code authorization before the
// seed, since registerWatchers() awaits every watcher's init() via
// Promise.all() and a flow that waits on a human would stall the whole
// controller's startup, not just this watcher.
// Bumped from 1690 for the concurrent-getContainers() generation-counter fix:
// a controllerLocalEnumerationGeneration field, the guard (and explanatory
// comment) around the recordControllerLocalEnumeration() call in
// getContainers() now also carries the isWatcherDeregistered check that
// guards against a call settling after deregisterComponent(), so an older
// concurrent call's listContainers() result can't overwrite a newer call's
// claim set.
test('Docker watcher implementation should stay under 1707 lines', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const dockerPath = path.resolve(path.dirname(currentFile), 'Docker.ts');
  const lineCount = fs.readFileSync(dockerPath, 'utf8').split('\n').length;

  expect(lineCount).toBeLessThanOrEqual(1707);
});
