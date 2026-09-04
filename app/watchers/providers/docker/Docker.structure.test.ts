import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// Bumped from 1600 for the v1.7.0 curl-healthcheck startup warning (one
// import + one call site in init()); the warning logic itself lives in
// curl-healthcheck-warning.ts to keep this file's growth to a minimum.
// Bumped from 1605 for the #869 unwatched-container-prune fix (one import +
// the watch-scope Set computed at the pruneOldContainers call site); the
// scope-set logic itself lives in getStillInWatchScopeContainerIds in
// docker-helpers.ts.
// Bumped from 1610 for the DR-106 startup-seed fix (one import + one call
// site in init()); the seeding logic itself lives in
// seedControllerLocalEnumeration in controller-local-container-ids.ts.
// Bumped from 1614 for the deregistered-watcher guard on getContainers():
// an isWatcherDeregistered check (plus explanatory comment) around the
// recordControllerLocalEnumeration() call, so a getContainers() call that
// settles after deregisterComponent() can't resurrect a dead watcher's
// claim set.
// Bumped from 1621 for the CodeRabbit finding on the v1.6 sibling PR: init()
// now refreshes remote auth headers before the DR-106 startup seed so a
// remote OIDC watcher's seed call doesn't go out unauthenticated, guarded by
// wouldRefreshRequireInteractiveOidcDeviceFlow() so a first-time device-code
// authorization can't block registerWatchers().
test('Docker watcher implementation should stay under 1700 lines', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const dockerPath = path.resolve(path.dirname(currentFile), 'Docker.ts');
  const lineCount = fs.readFileSync(dockerPath, 'utf8').split('\n').length;

  expect(lineCount).toBeLessThanOrEqual(1700);
});
