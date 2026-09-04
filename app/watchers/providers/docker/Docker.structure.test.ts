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
// Bumped from 1625 when that emit moved into announceMaintenanceWindowOpened, called by
// whichever scan consumes the armed catch-up queue rather than only by the 60s poll. The
// decision of when to announce lives in runCronWatch in docker-cron-watch.ts; this method
// is the emit plus the warn that keeps a failed announce from failing the scan.
// Bumped from 1640 for the DR-106 controller-local ownership fix (one import + one call
// site in getContainers()); the id-tracking logic itself lives in
// controller-local-container-ids.ts.
// Bumped from 1646 for the DR-106 startup-seed fix (one import + one call site in
// init()); the seeding logic itself lives in seedControllerLocalEnumeration in
// controller-local-container-ids.ts.
// Bumped from 1651 for the deregistered-watcher guard on getContainers():
// an isWatcherDeregistered check (plus explanatory comment) around the
// recordControllerLocalEnumeration() call, so a getContainers() call that
// settles after deregisterComponent() can't resurrect a dead watcher's
// claim set.
// Bumped from 1657 for the DR-106 remote-auth-refresh + seed-timeout fix:
// init() now refreshes a remote watcher's OIDC auth headers before the
// startup seed runs, guarded by wouldRefreshRequireInteractiveOidcDeviceFlow(),
// and the seed's listContainers() call is bounded by
// CONTROLLER_LOCAL_SEED_TIMEOUT_MS; the seeding logic itself lives in
// seedControllerLocalEnumeration in controller-local-container-ids.ts.
test('Docker watcher implementation should stay under 1730 lines', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const dockerPath = path.resolve(path.dirname(currentFile), 'Docker.ts');
  const lineCount = fs.readFileSync(dockerPath, 'utf8').split('\n').length;

  expect(lineCount).toBeLessThanOrEqual(1730);
});
