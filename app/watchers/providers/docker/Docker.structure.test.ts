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
// Bumped from 1610 for maintenancewindowscope (#946): one config field, its
// joi enum, and one import. The scope vocabulary lives in
// app/model/watcher-maintenance-window.ts and the gate predicate the two call
// sites share is isScanGatedByMaintenanceWindow in maintenance.ts.
// Bumped from 1620 for the #946 maintenance-window-opened emit: one call plus its
// comment in checkQueuedMaintenanceWindowWatch. The event itself lives in
// app/event/index.ts and the flush it drives lives in triggers/providers/Trigger.ts.
test('Docker watcher implementation should stay under 1625 lines', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const dockerPath = path.resolve(path.dirname(currentFile), 'Docker.ts');
  const lineCount = fs.readFileSync(dockerPath, 'utf8').split('\n').length;

  expect(lineCount).toBeLessThanOrEqual(1625);
});
