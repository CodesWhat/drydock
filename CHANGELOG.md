# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Fork point:** upstream post-8.1.1 (2025-11-27)
> **Upstream baseline:** WUD 8.1.1 + 65 merged PRs on `main` (Vue 3 migration, Alpine base image, Rocket.Chat trigger, threshold system, semver improvements, request→axios migration, and more)

## [Unreleased]

### Added

- **Fleet-aggregate stats subsystem ([commits `feature/v1.5-rc17`](https://github.com/CodesWhat/drydock/commits/feature/v1.5-rc17)).** New `ContainerStatsAggregator` polls each locally-monitored container once per tick (default 10 s) and computes a fleet-wide `ContainerStatsSummary` (total CPU%, total memory, top-N rows). Two new endpoints — `GET /api/v1/stats/summary` and `GET /api/v1/stats/summary/stream` — expose the current snapshot and a live SSE feed; the dashboard Resource Usage widget now consumes the SSE stream directly, fixing the regression (introduced in rc.13 by the `?touch=false` workaround) where the widget showed zeros because the per-container cache was never warmed. The legacy `GET /api/v1/containers/stats` endpoint and the client-side `summarizeContainerResourceUsage` rollup have been removed.

- **Per-container update locks ([commit `761fb834`](https://github.com/CodesWhat/drydock/commit/761fb834)).** New keyed `LockManager` primitive in `app/updates/locks.ts` replaces the module-level `pLimit(1)` that was serialising every container update across the entire process. Lock keys are derived per container (and per compose project for `Dockercompose`), so two unrelated containers can now pull and recreate concurrently while two services in the same compose project still serialise correctly. The lock primitive is its own pure-logic file with full unit tests; the docker trigger and compose subclass derive the lock key set via a new `getUpdateLockKeys(container)` method.
- **Restart recovery for queued and pulling updates ([commit `00788b13`](https://github.com/CodesWhat/drydock/commit/00788b13)).** Startup reconciliation in `app/store/update-operation.ts` is now selective: `status=queued` operations stay queued for the recovery dispatcher to pick up, and `phase=pulling` rows are reset to `queued` (pull is idempotent). All other in-progress phases — `prepare`, `renamed`, `new-created`, `old-stopped`, `new-started`, `health-gate`, `rollback-*` — remain marked failed because they leave inconsistent state that an operator should review. A new `app/updates/recovery.ts` module runs once after `registry.init()`, re-resolves trigger and container for each queued operation, and dispatches them through the existing fire-and-forget pipeline. Operations whose container or trigger no longer exists are marked failed with an explanatory `lastError` so they don't sit in the queue forever.
- **Notification outbox with retry and dead-letter queue ([commits `a9561d93`, `7d2ef6eb`, `b215d295`, `ce26bece`](https://github.com/CodesWhat/drydock/commits/feature/v1.5-rc17)).** New `notificationOutbox` LokiJS collection (`app/store/notification-outbox.ts`) and matching `app/notifications/outbox-worker.ts` background worker provide durable retry semantics for notification dispatch. `Trigger.dispatchContainerForEvent` now optimistically calls `this.trigger(container)` directly; on failure, the delivery intent is persisted to the outbox and the worker retries on a periodic drain with exponential backoff + jitter. After a configurable number of failed attempts (default 5) entries transition to the dead-letter queue; delivered and dead-letter entries are auto-purged past TTL (default 30 days). New `/api/notifications/outbox` REST surface lets operators list entries (`?status=` filter), retry from the DLQ (`POST /:id/retry`), or discard (`DELETE /:id`). New base method `Trigger.dispatchOutboxEntry(entry)` is the worker's delivery hook; subclasses can override.
- **Notification outbox UI ([commit `feature/v1.5-rc17`](https://github.com/CodesWhat/drydock/commits/feature/v1.5-rc17)).** New `Notification outbox` page (route `/notifications/outbox`, nav under *Settings*) consumes the existing `/api/notifications/outbox` REST surface so operators can review the dead-letter queue, retry stuck deliveries, or discard dead entries from the UI. Status tabs (Dead-letter / Pending / Delivered) keep the same query-param convention (`?status=`) used by the rest of the list views; counts per bucket render as inline badges. `Retry` is shown only on dead-letter rows; `Discard` is available everywhere. New `ui/src/services/notification-outbox.ts` mirrors the API exactly.
- **Cancel queued or in-flight updates ([commits `4b79e3ac`, `79487115`](https://github.com/CodesWhat/drydock/commits/feature/v1.5-rc17)).** `POST /api/operations/:id/cancel` now accepts both queued and in-progress operations. Queued ops are marked failed immediately with `lastError: 'Cancelled by operator'` (200). In-progress ops are flagged via a new `cancelRequested` field on the operation row and the endpoint returns `202 Accepted`; the lifecycle observes the flag at three safe checkpoints — after pull and before rename (clean abort, no rollback needed), before creating the replacement container, and before stopping the old container — so cancellations either short-circuit cleanly or fall through the existing rollback path that renames the container back. The rollback path tags the rollback reason as `cancelled` so the audit trail distinguishes operator cancellations from real failures. Already-terminal ops still return `409 Conflict`. The container row's Cancel action is now visible for both queued and in-progress operations; the toast says "Cancelled" for the immediate path and "Cancellation requested" for the in-progress path.
- **Global concurrent-update cap (`DD_UPDATE_MAX_CONCURRENT`).** New counting semaphore (`Semaphore` class in `app/updates/locks.ts`) provides a configurable global gate on how many update lifecycles run simultaneously across the entire controller instance. Default `0` = unlimited — no behavior change on upgrade. Positive integer `N` means at most N updates run concurrently. Negative or non-integer values fail fast at startup with a descriptive error. The cap layers on top of the existing per-container and per-compose-project locks; it does not replace them. Operations waiting on the cap remain in `queued` status. Scope is per controller instance; distributed agent hosts have independent counters by design. Self-update operations bypass the global cap — they take per-container locks but never wait on the global semaphore, preventing a full update queue from starving an admin-triggered self-update.

### Changed

- **Watcher dispatch is fully fire-and-forget ([commit `5cfa2286`](https://github.com/CodesWhat/drydock/commit/5cfa2286)).** `Trigger.runUpdateAvailableSimpleTrigger` and `runAcceptedUpdateBatch` previously awaited `runAcceptedContainerUpdates`, so a slow update lifecycle stalled the next watcher tick. The API path was already fire-and-forget; the watcher path now matches. New `dispatchAccepted(accepted)` helper centralises the `void runAcceptedContainerUpdates(...).catch(() => undefined)` pattern across all four call sites. Per-operation failures are still terminalised inside the lifecycle handler, so swallowing the dispatch chain's rejection loses no observable information.
- **Security alert emit is non-blocking inside the update lifecycle ([commit `6c5198dd`](https://github.com/CodesWhat/drydock/commit/6c5198dd)).** `SecurityGate.maybeEmitHighSeverityAlert` was awaited inside `evaluateScanOutcome`, which itself runs inside the update lifecycle's critical path. With multiple notifiers registered for security alerts, the await chained sequential provider calls (SMTP, Slack, HTTP, MQTT, webhook) into the lifecycle, multiplying latency before pull/recreate could even start. The function now returns synchronously after firing the emit; notification dispatch semantics from the caller's perspective are unchanged (the same handlers run in the same order via `emitOrderedHandlers`), the lifecycle just no longer waits.
- **"Update started" toasts renamed to "Update queued" ([commit `79487115`](https://github.com/CodesWhat/drydock/commit/79487115)).** Dispatch is fire-and-forget — by the time the toast renders, the lifecycle hasn't started, the operation is just queued. The text now matches what actually happened: `"Update queued: {name}"`, `"Force update queued: {name}"`, `"Queued update(s) for N container(s)"`. Function names in `ui/src/utils/container-update.ts` are unchanged so call-site churn is zero.

### Fixed

- **One slow notifier no longer stalls every container update ([commit `761fb834`](https://github.com/CodesWhat/drydock/commit/761fb834)).** The module-level `pLimit(1)` introduced in v1.5 to serialise concurrent updates was the root cause behind reports of stuck queues whenever a single notifier hung — every update on every container was waiting for the same single slot. Per-container locks remove the global bottleneck while still preventing a container from being updated twice in parallel.
- **Process restart no longer wipes the queued update list ([commit `00788b13`](https://github.com/CodesWhat/drydock/commit/00788b13)).** Previously every active operation was force-failed on startup. Queued and pulling-phase operations now resume; only operations mid-destructive-step (renamed/new-created/old-stopped/etc.) are surfaced for operator review. See the matching addition above.
- **Transient notifier outages no longer drop alerts ([commit `b215d295`](https://github.com/CodesWhat/drydock/commit/b215d295)).** Direct dispatch failures land in the outbox and are retried with exponential backoff + jitter; only persistently failing entries (default: 5 failed attempts) move to the dead-letter queue. Crash-during-dispatch is the only remaining loss window.

## [1.5.0-rc.16] — 2026-04-28

### Added

- **i18n framework migration ([refs #329](https://github.com/CodesWhat/drydock/issues/329)).** Bulk vue-i18n migration of ~73 `.vue` files into per-namespace JSON catalogs under `ui/src/locales/en/` (eight namespaces: `dashboardView`, `containersView`, `configView`, `agentsView`, `listViews`, `containerComponents`, `appShell`, `sharedComponents` — auto-loaded by an `import.meta.glob` in `boot/i18n.ts` so new namespaces are picked up automatically). Plus AuthView, LoginView, LogsView, and ContainerLogsView migrated as part of the same pass. Static label arrays (`tableColumns`, `settingsTabs`, etc.) wrapped in `computed()` so they react to runtime locale changes; pure leaf components with no translatable strings intentionally left untouched (no useless `useI18n()` imports). Coverage by batch: dashboard view + 6 widgets (~55 strings), ContainersView shell (~8), ConfigView + 4 tabs (~65 — `DD_*` env names left untranslated), AgentsView + 3 detail tabs (~65), 7 list views (Audit/Notifications/Security/Registries/Servers/Triggers/Watchers, ~150), 19 container components (~250), app-shell — AppLayout/AppToast/NotificationBell/ThemeToggle/AnnouncementBanner/AppLogViewer (~76), and 17 shared/data components (~27). Foundation for the v1.8.0 Crowdin integration; English remains the only catalog shipped in 1.5.0.
- **Update-button per-row state machine.** New `updateButtonState()` / `primaryBlockerForButton()` helpers in `ui/src/utils/update-eligibility.ts` are a single source of truth for the four update-button states (`none`/`ready`/`soft`/`hard`), wired into `ContainersGroupedViews` across the icons / buttons / cards mode action cells. Replaces the previous ad-hoc inline logic that had drifted between the three view modes. Covered by a new `ContainersGroupedViews.button-states` spec file.

### Changed

- **Soft eligibility blockers de-emphasized by default ([discussion #325](https://github.com/CodesWhat/drydock/discussions/325)).** Container row pills had been styled identically regardless of severity, so soft/informational reasons (Snoozed, Trigger filtered, Below threshold) read as alarmingly as hard/blocking ones (Agent mismatch, Security blocked). Soft blockers now render with neutral muted styling (`bg-elevated` / `text-muted`) so hard blockers visually dominate the row, and active blockers sort hard-first so the primary compact pill always reflects the most actionable reason — even when the API pushes a soft blocker earlier in the list. This now ships as default behavior with no user toggle (intermediate experimental preferences `eligibilityPills.{showSoft,deemphasizeSoft}` and `containers.showAutoUpdateDiagnostic` were prototyped within rc.16 and removed before release — see `Removed` below).
- **Preferences schema bumped 2 → 4.** Both `v2 → v3` and `v3 → v4` migrations are now plain version bumps with no field changes, after the experimental `eligibilityPills` and `showAutoUpdateDiagnostic` shapes added during rc.16 development were dropped. The version bump is a placeholder so any preferences blob touched by an in-development rc.16 build is normalized forward without re-introducing dead fields.
- **Tag-last release pipeline ([fixes #306](https://github.com/CodesWhat/drydock/issues/306)).** Collapsed `release-cut.yml` and `release-from-tag.yml` into a single workflow where the git tag push is the **last** step, performed only after the Docker image has been built, pushed to all three registries, signed with cosign, attested (SLSA), and the signed release tarball has been generated and verified. Enforces the invariant: **if the git tag exists, the image exists** — there is no longer any window of user-visible incoherence where rc.N can appear in the tag list / CHANGELOG / Drydock's own registry watcher while `ghcr.io/codeswhat/drydock:<version>` returns 500 because the build never finished. The tag-push trigger workflow (`release-from-tag.yml`) is deleted; manual v-tag pushes outside the workflow no longer publish. Cosign identity now pins to `release-cut.yml@refs/heads/main` and a branch guard at the top of the job rejects dispatches from non-`main` refs so the OIDC identity is stable. Docs (`content/docs/current/configuration/security`, `content/docs/current/guides/verifying-releases`) carry both the new regex (v1.5.0-rc.11+) and a legacy regex covering v1.5.0…v1.5.0-rc.10 signed by the old workflow.

### Fixed

- **[#328](https://github.com/CodesWhat/drydock/issues/328) — Triggering a security scan emitted a "container update" notification (begunfx).** The same symptom previously hypothesised at rc.13 as `updateKind` snapshot loss — it was actually a wrong-template render. `Trigger.flushSecurityDigestBuffer` calls `triggerBatch(rows, runtimeContext)` with the security-digest title/body prerendered in `runtimeContext`, but every notification provider's `triggerBatch` ignored the second argument and re-rendered the stub rows with the *update-available* batch templates. The result: the user saw a `"64 updates available"` subject and a body of `"Container X running with  can be updated to "` — with empty version slots because the rows have no `updateKind`. The fix is structural: the base `Trigger` now exposes a typed `BatchRuntimeContext` (`{ eventKind, title, body }`), and `renderBatchTitle` / `renderBatchBody` / `composeBatchMessage` honour `runtimeContext.title` / `.body` verbatim when set. All 16 notification providers (Smtp, Slack, Discord, Telegram, Teams, Mattermost, Googlechat, Rocketchat, Matrix, Apprise, Gotify, Ntfy, Pushover, Ifttt, Http, Kafka) plus Mock and Command thread `runtimeContext` through to those helpers, so the security-digest path now produces the configured `securitydigesttitle` / `securitydigestbody` (or the digest defaults) instead of update-available output. Both the scheduled cron scan path and the on-demand `POST /containers/scan-all` path are fixed. The previously-deferred half of [#308](https://github.com/CodesWhat/drydock/discussions/308) ("empty `updateKind.*` fields in security-scan emails") is closed by this — it was the same bug.
- **TypeScript errors after `Container` type tightening (rc.16 internal cleanup).** Three source-side fixes: `ContainerUpdateOperation.status` now uses the wider `ContainerUpdateOperationStatus` union including terminal states (matches how callers actually use it); `ContainerActionTarget`'s `Pick<>` widened to include `updateEligibility` since call sites already read it; `useDashboardComputed` collapsed multi-line `assertNever` returns to single-line guards with `as never` cast so unknown statuses throw the descriptive error rather than silently returning `undefined` into a property access. Test fixture fixes: added `identityKey` to `Container` literals across 7 spec files (now required on `Container`); `ContainersGroupedViews` registry uses the in-enum value (`'custom'`) and its `registryLabel` mock mirrors the real signature so `registryName` fallback works; `useVulnerabilities` typed `ref<Container[]>([…])` so fixtures narrow correctly.

### Removed

- **Experimental `eligibilityPills.{showSoft,deemphasizeSoft}` preferences dropped before release.** Added during rc.16 development as user-facing toggles for the new soft-pill styling, then removed once the per-row update-button state machine took ownership of the surface. The de-emphasis is now baseline behavior with no toggle.
- **Experimental `containers.showAutoUpdateDiagnostic` preference + `compact` variant of `UpdateEligibilityBadges` dropped before release.** Briefly served as an alternate way to suppress soft diagnostic badges in the table while keeping detail panes verbose. Removed alongside the two preferences above; `UpdateEligibilityBadges` now always renders the full blocker stack used by the slide-in / full-page detail surfaces, and the "Auto-update diagnostic pills" section in `ConfigAppearanceTab.vue` is gone. Net code delta: −384 lines of test scaffolding for shapes that no longer exist.
- **Two pre-existing unused imports** flagged by biome's `noUnusedImports` (`updates/request-update.ts` default `Trigger` import; `Docker.containers.processing-retrieval.test.ts` `mockGetFullReleaseNotesForContainer` import). Verified unused by inspection. Clears all lint warnings to zero.

### Tests / CI

- **`BatchRuntimeContext` coverage for #328.** 9 base-`Trigger` tests cover `renderBatchTitle` / `renderBatchBody` / `composeBatchMessage` — `runtimeContext.title` / `.body` returned verbatim, fallback to template rendering when absent, fallback when only `eventKind` is supplied. 3 Smtp tests including a full end-to-end via `handleSecurityAlertEvent` → `handleSecurityScanCycleCompleteEvent` → real `triggerBatch` + mock transporter, asserting the captured `sendMail` subject/body do **not** contain `"updates available"` or `"can be updated to"` (the broken-render fingerprints from the bug report). Discord and Rocketchat existing `triggerBatch` tests updated for the new `(containers, runtimeContext)` call shape.

## [1.5.0-rc.15] — 2026-04-27

### Fixed

- **[#308](https://github.com/CodesWhat/drydock/discussions/308) — Per-row scanning chip wasn't anchored to the container being scanned (begunfx, rc.14).** Backend was already broadcasting `dd:scan-started` / `dd:scan-completed` with `{ containerId, status }` payloads, but the UI's SSE service was dropping the payload on the floor — both listeners emitted bare bus events with no container reference. The per-row "Scanning" chip was therefore driven entirely by the optimistic local `actionInProgress` map populated when the user clicked Scan, which (a) couldn't reflect cron-driven scheduled scans and (b) was tied to the HTTP request lifecycle instead of the actual scan lifecycle. Threaded the `containerId` through the SSE service → bus → AppLayout `dd:sse-scan-started` / `dd:sse-scan-completed` CustomEvent payloads, added a singleton `useScanLifecycle` composable that maintains a `scansInFlight` set keyed by container id (with a 120s safety timeout), and refactored `scanContainer` so the per-row chip is set on click and cleared by the SSE completion event (or on HTTP failure). The chip now stays correctly anchored to the row whose container is actually being scanned, regardless of whether the scan was started by a click or by the scheduler.
- **[#308](https://github.com/CodesWhat/drydock/discussions/308) — Scanning chip escaped its row and floated in viewport-fixed gutter space (begunfx, rc.14).** The icon-column overlay chip is `position: absolute; inset: 0`, which requires a positioned ancestor on the `<tr>` to stay pinned to the row. The repo already documents this in `style.css` and applies the `transform: translateZ(0)` containing-block hack via the `dd-row-updating` class — but rc.13 deliberately decoupled scan from the lock state (scan must keep the row interactive), which removed the containing-block hack from scanning rows as a side-effect. Without a positioned ancestor the chip escaped up the layout tree and rendered at a fixed viewport position, appearing in the gutter between unrelated rows or section headers and persisting across scrolls until the scan completed. Added a sibling `dd-row-scanning` class (containing block only — no opacity dimming, no `pointer-events-none`) and applied it from `tableRowClass` whenever a row is scanning but not locked. Locked-state still wins when a row is somehow both updating and scanning.
- **[#317](https://github.com/CodesWhat/drydock/issues/317) — Lifecycle notifications silenced by `auto: false` (begunfx, rc.14).** A notification trigger configured with `auto: false` (a common Pushover setup to suppress every-detection update-available spam) was *also* silently losing every other lifecycle notification — `update-applied`, `update-failed`, `security-alert`, `agent-connected`, `agent-disconnected`. The init code wrapped *all* event registrations in a single `if (auto !== 'none')` block. Decoupled them: auto-fire-on-detection handlers stay gated by `auto`, lifecycle handlers register unconditionally. A user who's configured the trigger at all now gets completion / failure / security / agent notifications regardless of how `auto` is set.
- **[#317](https://github.com/CodesWhat/drydock/issues/317) — Lifecycle notification rules silently dropped triggers without an explicit allow-list.** `update-applied` / `update-failed` / `security-alert` / `agent-connect` / `agent-reconnect` dispatched with `allowAllWhenNoTriggers: false` while `update-available` used `true`. The asymmetry meant a notification rule with no per-rule allow-list silently disabled lifecycle notifications even though `update-available` worked. Flipped the four lifecycle dispatch sites to match: empty / missing allow-lists now permit dispatch. Explicit per-rule allow-lists still win when populated.
- **[#317](https://github.com/CodesWhat/drydock/issues/317) — Update button bypassed eligibility blockers, queuing requests the API would only reject one-by-one (s-b-e-n-s-o-n, rc.14).** The Update button (per-row + Update-all) only gated on the legacy `bouncer === 'blocked'` (security scan), even though rc.13 added 11 other eligibility blocker reasons surfaced as row pills. Clicking Update on a row pill-marked **AGENT MISMATCH** produced the toast `No docker trigger found for this container`; clicking Update-all on a stack of TRIGGER FILTERED proxies queued every row before the API rejected each one individually. Added a `severity: 'hard' | 'soft'` field to `UpdateBlocker` and made `update-eligibility` the single source of truth: the API rejects manual updates on any hard blocker with the blocker's user-friendly message; the UI locks the Update button on hard blockers and shows a confirm-modal warning on soft blockers ("This update is currently policy-blocked: …  Click Update anyway to override.").

### Changed

- **`security-scan-blocked` now also fires when the *current* container's scan status is blocked.** Previously the eligibility model only inspected `security.updateScan` (the candidate) while `request-update.ts` independently inspected `security.scan` (the running image). Both gates are now unified under the eligibility blocker — either being `blocked` halts a manual update with the same 409 + "Security scan is blocking this update" message. Use the existing force-update path to override.

### Deprecated

- **`dd.action.include` / `dd.action.exclude` (and legacy `dd.trigger.include` / `dd.trigger.exclude`) become hard manual-update blockers in v1.7.0.** v1.5.x keeps them as soft blockers — the pill reads *Trigger filtered* / *Trigger excluded* but the manual Update button stays clickable (with a warn-and-confirm). v1.7.0 will lock the button and reject the API call when the labels filter out the matching trigger. See [DEPRECATIONS.md](./DEPRECATIONS.md) for migration guidance.

## [1.5.0-rc.14] — 2026-04-26

### Fixed

- **Update-eligibility pill never rendered (rc.13 regression).** The blocker pills shipped in rc.13 (`Trigger filtered`, `Below threshold`, `Maturing`, etc.) silently rendered nothing for every container in every view (table rows, side panel, full-page detail, dashboard widget). The backend computed eligibility correctly and serialised it in the API response, but the UI's `mapApiContainer()` didn't declare or pass through the `updateEligibility` field — TypeScript's structural typing dropped the unknown JSON property at the boundary. Fix is two-part:
  - **UI mapper** — `ApiContainerInput` now declares `updateEligibility`, and `mapApiContainer` passes it through with a `deriveUpdateEligibility` validator that rejects malformed eligibility objects (missing `eligible` boolean, missing `evaluatedAt`) and filters out malformed individual blockers (bad `reason` strings, missing `message`). One change lights up every consumer (list, side panel, full-page, dashboard).
  - **Backend SSE enrichment** — the store broadcasts raw container objects on `dd:container-added` / `dd:container-updated`, but `updateEligibility` is computed on-demand in the list handler and never persisted. Without enrichment, live SSE patches would deliver containers with eligibility undefined, flickering the pill on every update. New `sse-container-enrichment.ts` helper computes eligibility from registry triggers + active operations and attaches it to each lifecycle payload before broadcast.
  - Reported in [#307](https://github.com/CodesWhat/drydock/discussions/307).
- **[#323](https://github.com/CodesWhat/drydock/discussions/323) — Popovers on the Containers list rendered off-screen for the last row + drifted on scroll.** The "More" actions menu and the column picker both used `position: fixed` with coordinates captured from the trigger's `getBoundingClientRect()` and unconditionally opened *below* the trigger. When the trigger sat near the bottom of the viewport (e.g. the last container row), the menu was clipped off-screen and inaccessible. The popovers also stayed at their captured pixel coordinates while the table scrolled, drifting away from the trigger. Added a small `buildPopoverStyle` helper that measures available space below vs above and flips the popover upward when there's not enough room below; added a global `scroll` listener (capture phase, to catch internal scroll containers) that closes both popovers since their fixed coordinates can't track a moving anchor. Sibling popovers in this codebase (NotificationBell, etc.) intentionally untouched here — different UX surfaces, separate consideration.

### Tests / CI

- **Eligibility coverage closed end-to-end.** 13 new mapper unit tests (full eligibility roundtrip including `actionHint` / `liftableAt` / `details`, all 13 valid `UpdateBlockerReason` values, malformed-blocker filtering, missing-field rejection, non-array `blockers` handled as empty list). 7 new SSE enrichment tests (happy path, malformed payloads, error resilience). The 55 existing `UpdateEligibilityBadges` component tests already covered the render gate. Manual verification: built `drydock:dev` with the fix, ran with `DD_ACTION_DOCKER_LOCAL_AUTO=oninclude`, confirmed 23 backend `trigger-not-included` blockers render as 23 amber "Trigger filtered" pills in the Kind column.
- **Popover positioning coverage.** 6 new tests in `ContainersView.spec.ts`: actions menu and column picker each flip up when the trigger is near viewport bottom; global scroll closes the actions menu, closes the column picker, and is a no-op when nothing is open; scroll listener is removed on unmount. Manual verification: built `drydock:dev` with the fix, scrolled the last container row to the viewport bottom, opened its More menu — the menu rendered fully within the viewport (anchored bottom: 48px from viewport top) instead of clipping off-screen.

## [1.5.0-rc.13] — 2026-04-24

### Added

- **Update-eligibility blockers on container rows** — Backend surfaces 12 structured blocker reasons (`maturity-not-reached`, `container-paused`, `no-update-detected`, etc.) per container, and the Containers list renders them inline so users see *why* a row isn't updating without opening the detail drawer. Amber for `maturity-not-reached` (informational — will self-clear at the maturity threshold), red for terminal blockers.
- **`GET /update-operations/:id` endpoint** — Returns the current state of a specific update operation. The UI falls back to this endpoint when the terminal SSE is missed (reverse-proxy reconnect-without-replay), so update toasts and hold release still fire even when the browser never saw the final server-sent event.

### Fixed

- **[#308](https://github.com/CodesWhat/drydock/issues/308)** (partial) — Two of the three reporter symptoms are resolved:
  - **Row status during scan.** Triggering a scan from the row's `...` menu no longer shows "Updating" on the row. `actionInProgress` now tracks the *kind* of action per container (`update` / `scan` / `lifecycle` / `delete`) instead of a bare id set, and the status label and row-lock predicates read from the per-kind map so a scan in progress shows "Scanning" and doesn't dim other row actions.
  - **Batch-mode triggers on single-container scans.** Providers that only listen to `emitContainerReports` (batch-mode, e.g. Pushover) were silently skipped on single-container scan paths, which only emitted the `emitContainerReport` singleton. Threaded `{ emitBatchEvent: true }` through the `watchContainer` call from the single-scan handler so batch-mode triggers fire too.
  - **Still open:** the empty `updateKind.{kind,localValue,remoteValue}` fields in simple-template notification email bodies reported by begunfx. The dispatch snapshot shouldn't normally lose `updateKind` — needs a repro to chase the root cause.
- **[#317](https://github.com/CodesWhat/drydock/issues/317)** — Two fixes around reconnect-without-replay SSE:
  - Rollback actions no longer broadcast spurious container-lifecycle events (`dd:sse-container-added`/`-removed` in quick succession) while the store is mid-recreate.
  - When the terminal update-operation SSE is missed, the Containers view's reconciliation pass now releases the display hold and fires the update toast from the reconciled state, matching what would've happened on a live SSE.
- **[#318](https://github.com/CodesWhat/drydock/issues/318)** — Kind and status columns in the Containers list now stay visible at narrow viewports. The container-query thresholds that gated column visibility were tripping too early; adjusted so the columns survive down to the minimum useful table width.
- **[#291](https://github.com/CodesWhat/drydock/issues/291)** (rc.12 follow-up) — Dashboard update flow now shares the same `useOperationDisplayHold` composable that the Containers view uses, fixing the last two reporter symptoms that survived rc.12 on the dashboard path. (1) The updating row no longer drops to the bottom of the Recent Updates widget mid-update: the backend transiently clears `updateDetectedAt` while the container recreates, which was sorting the ghost row last — the shared hold now overlays the snapshotted `updateDetectedAt` so sort position is stable through the whole update window. (2) A dropped terminal SSE (Synology DSM reverse-proxy style reconnect-without-replay) no longer leaves the dashboard silent: the view now reconciles holds against refreshed container data and falls through to `GET /update-operations/:id` the same way the Containers view did. Both views are now driven by one hold map, one sort-snapshot overlay, and one reconciliation fallback.

### Performance

- **[#301](https://github.com/CodesWhat/drydock/issues/301)** (rc.11 follow-up) — Dashboard and Containers view now do dramatically less work on every SSE reconnect. Addresses the residual slow-load reports on those two pages after the rc.10/rc.11 backend fixes.
  - **Dashboard reconnect refresh is live-only.** On `dd:sse-connected` the dashboard now refetches only the endpoints that can go stale between frames (`/containers`, `/containers/stats`, `/containers/recent-status`) and TTL-guards the static ones (`/server`, `/agents`, `/watchers`, `/registries`) for 30s. `dd:sse-resync-required` (server-signaled state loss) still forces a full 7-endpoint fan-out — the TTL skip only applies to reconnect blips. On a flaky Synology LAN this turns a reconnect storm into a handful of requests instead of 7× that.
  - **Dashboard stats read no longer warms Docker stats streams per container.** `GET /api/v1/containers/stats` accepts a new `?touch=false` query param; the dashboard uses it so a summary read returns already-cached snapshots without spinning up a per-container Docker stats stream. The Containers view / detail panel still pass the default (`touch=true`) so streaming stats stay warm where they actually render.
  - **Containers list dedup fingerprint is ~30× cheaper.** `loadContainers()` was recursively fingerprinting every field (including `details.ports`/`volumes`/`env`/`labels` arrays) on both the incoming and current lists to skip redundant reactive reassignment. Replaced with a flat hash of the ~13 scalar fields that actually affect row rendering. Identity-and-tag changes still trigger reassignment; deep-field-only changes that never reach the list render no longer do.
  - **SSE lookup-map churn halved.** `updateLookupMapsForContainer` was doing 4 full-map spreads (`{ ...map, ...key }`) per container SSE event; collapsed to 2. `removeLookupMapsForContainer` collapsed the same way and skips reassignment entirely when neither the id nor the alias is present.

### Docs

- **v1.5.0 deprecation sweep.** Migrated every documentation example and test fixture off the v1.5.0-deprecated `DD_TRIGGER_*` / `dd.trigger.*` prefixes onto canonical `DD_NOTIFICATION_*` + `dd.notification.*` (messaging providers) and `DD_ACTION_*` + `dd.action.*` (update executors). Touched 29 files in `content/docs/current/**`, the in-repo README roadmap and Recent Updates sections, CONTRIBUTING, all QA/CI/demo compose fixtures (except `migration-test-compose.yml`, which intentionally exercises the legacy prefix), and the apps/web landing-page roadmap. The legacy prefixes still work as aliases through v1.7.0 — this sweep makes every *example* in the project canonical so new users stop copy-pasting deprecated forms. See `DEPRECATIONS.md`.
- **Registry credentials: `*_TOKEN` → `*_PASSWORD`.** The Docker Hub and DHI provider docs no longer instruct users to set `DD_REGISTRY_HUB_PUBLIC_TOKEN` (deprecated) — examples now use `DD_REGISTRY_HUB_PUBLIC_PASSWORD`, matching the canonical form every other registry provider already documents.

### Tests / CI

- **Dashboard helper + computed coverage** — Added targeted tests for `createRealtimeRefreshScheduler`'s `full-live` → `refreshFull` fallback branch (when no full-live handler is configured) and for the WeakMap cache-hit branch of `useDashboardComputed`'s name-counts memoization. Closes the last two UI coverage gaps left after rc.12.

## [1.5.0-rc.12] — 2026-04-22

### Fixed

- **[#315](https://github.com/CodesWhat/drydock/issues/315)** — Self-update now works against private registries whose `registry.url` is stored as the v2 API base (e.g. `https://ghcr.io/v2`). `resolveHelperImage` in the Docker action trigger was building the helper image reference by concatenating `registry.url` verbatim with `name:tag`, producing `https://ghcr.io/v2/codeswhat/drydock:1.5.0` — which Docker's `POST /containers/create` rejects with HTTP 400. The fix normalizes the reference to match `Registry.getImageFullName` (scheme and `/v2` stripped) so the self-update helper spawn uses the same image shape as the pull path. No-scheme / no-v2 registries fall back to `name:tag`.
- **[#309](https://github.com/CodesWhat/drydock/issues/309)** — Status column in the Containers list now shows its label alongside the icon at typical widths. The column was width-capped at 90px which fell below the shared `dd-cell-show-80` container-query threshold (80px) once the 10px padding was subtracted — widened to 120px so the label renders whenever the column is visible.
- **[#291](https://github.com/CodesWhat/drydock/issues/291)** (rc.11 follow-up) — Terminal update toasts (`Updated: <name>` / `Update failed: <name>` / `Rolled back: <name>`) now fire *after* the operation display hold ends instead of on the raw terminal SSE. The container row stays visually in "updating" for another 1.5s (`OPERATION_DISPLAY_HOLD_MS`) after the terminal event so it settles without flicker, but the toast was announcing the outcome before the UI reflected it. Wrapped the three terminal toast calls in `setTimeout(..., OPERATION_DISPLAY_HOLD_MS)` in both `ContainersView.applyOperationPatch` and `DashboardView.handleTerminalOperationSse` so the row releases first and the toast lands right after.
- **Dashboard fly-in animation on update actions** — Three `fetchDashboardData()` calls in `DashboardView` (single-update `onAccepted`, `onStale`, and the update-all finalizer) were refreshing without `{ background: true }`, which flipped `state.loading` to true and caused the `<GridLayout v-if="!loading">` to unmount and remount — re-triggering grid-layout-plus's initial positioning transitions (the "fly in from the left" rebuild reporters saw after every update). Switched those three calls to the background variant so the grid stays mounted and only the underlying widget data refreshes in place.
- **Pre-push e2e hook timeout** — `scripts/run-e2e-tests.sh` unconditionally restarted Colima before every run, which scaled badly once the dev host accumulated QA fixtures (VM cold-boot with 45+ attached containers exceeded the lefthook 10m timeout before cucumber started). Default `DD_E2E_RESTART_COLIMA` to `auto` — skip the restart when `docker info` already succeeds, and only force one when the engine is actually wedged. Set to `true` / `false` to override.

### Security

- **fast-xml-parser override 5.5.8 → 5.7.1** — Addresses [GHSA-gh4j-gqv2-49f6](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-gh4j-gqv2-49f6) / CVE-2026-41650 (XML comment/CDATA injection via unescaped delimiters in `XMLBuilder`, medium). Vulnerable range ≤ 5.5.12, patched in 5.7.0; bumped both `app/` and `e2e/` workspace overrides to 5.7.1 (latest).
- **uuid 13.0.0 → 14.0.0** — Addresses [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) (missing buffer bounds check in `v3`/`v5`/`v6` when `buf` is provided, medium). Vulnerable range ≤ 13.0.0, patched in 14.0.0. Drydock only uses `v4` (unaffected by the buffer path) but the scanner flags any vulnerable version in the tree. Bumped the app's direct dep and added `uuid: 14.0.0` to both `app/` and `e2e/` overrides so transitive callers (dockerode, artillery, @azure/msal-node, @ngneat/falso) also resolve the patched version.

### Performance

- **Granular SSE container patch** — Container list updates triggered by `dd:sse-container-added` / `-updated` / `-removed` now patch the local containers array in place instead of refetching the full list over HTTP. Preserves row identity via a prototype-chain merge so Vue's reactivity system reuses the existing row DOM nodes, eliminating the post-SSE flicker and the polling refetch that the previous debounced-reload path required.
- **`shallowRef` for `heldOperations` map** — The operation display-hold store swapped from a deep `ref(Map)` to `shallowRef(Map)` plus explicit `triggerRef` on mutation. Avoids Vue walking the entire map on every held-row render in large inventories.

### Changed

- **Expand all / Collapse all bulk toggle** — Replaced the single chevron toggle in the Containers toolbar with an explicit "Expand all" / "Collapse all" button whose label reflects the current global expand state. Individual stack headers still toggle their own group; this is the bulk shortcut on top.
- **Compact "Suggested" badge** — The "Suggested" tag badge on container rows now renders compact (the full suggested tag moves into a tooltip on hover) so the row metadata band stays readable at narrower column widths.

### Tests / CI

- **Thin test hardening** — `app/agent/index.test.ts` grew 5 → 11 tests. Existing coverage verified call *counts* but not argument correctness, same-instance registration, fire-and-forget `client.init()` behavior, skip-branch warning messages, or mixed valid/invalid registry state. Added behavioral assertions for each while keeping 100% coverage.
- **SSE / pending-poll / hold-release edge coverage** — New tests for `useOperationDisplayHold`, `useContainerActions.pollPendingActionsState`, and `applyDashboardContainerPatch` close the remaining uncovered branches (delete-no-op, in-flight poll guard, removed-kind patches, Object.assign merge, push-new, mapApiContainer throw, container-removed SSE listener).
- **QA compose fixture trims** — Shrank test-fixture images so update flows finish in seconds instead of minutes, and swapped `timescaledb-ha` → non-HA to unblock scan tests that were failing against the HA variant's readiness probe.
- **Release pipeline fragility fixes** — Three recurring CI failures in the release cut path addressed (see `a1ea1a82` on `fix/ci-release-fragility`, renamed to `feature/v1.5-rc12`).

## [1.5.0-rc.11] — 2026-04-21

### Added

- **[#299](https://github.com/CodesWhat/drydock/discussions/299)** — **Inline update action in Security view.** Image rows in the Security view now show an "Update" action button directly next to the vulnerability data when a newer image is available, instead of only offering navigation away to the Containers view. Single-container images open a confirmation dialog in place; multi-container images open a compact chooser popover to pick which instance to update. A secondary "View in Containers" link remains for cases where the user wants to inspect the full container state first. The `ContainerUpdateDialog` component is extracted as a standalone reusable piece. The Containers view now accepts a `?containerIds=<csv>` query parameter to pre-filter to a specific set of containers, with a dismissable filter chip in the toolbar.
- **SSE Last-Event-ID replay (#289)** — The server now stamps every broadcast event with a monotonic `<bootId>:<counter>` id and retains a 5-minute time-bounded ring buffer. Clients reconnecting with a `Last-Event-ID` header receive every event they missed; if the buffer has evicted the requested id (or the server booted since), the client receives a `dd:resync-required` event and the UI refetches view state. Replaces the previous best-effort reconnect that could leave container rows stuck in an "updating" state when a terminal SSE was dropped during a watcher-scan window.
- **Dashboard recent-updates row navigation (#311 adjacent)** — Clicking a row in the dashboard "Updates Available" widget now navigates to `/containers?containerIds=<id>`, focusing the Containers view on that single container. Interactive controls inside the row (Update button, Release notes link) retain their own behavior via `@click.stop`.
- **Expand/Collapse all stacks toggle (Discussion #311)** — A single toggle button appears next to the Group-by-Stack icon in the Containers toolbar when Stack view is on. When every stack is collapsed the icon points down and clicking expands all; otherwise it points up and clicking collapses every stack. Individual stack headers still toggle their own group as before — this is purely a bulk shortcut on top of that.

### Fixed

- **[#305](https://github.com/CodesWhat/drydock/issues/305)** — Hide Pinned now hides *every* pinned container again, matching rc.8 behavior and the reporter's expectation when combining Hide Pinned with Has Update. #293 had carved out an exception for pinned rows with a pending update, but that conflated "declutter" with "surface actionable pins" and broke the filter for users who pin infrastructure containers (databases, edge, etc.) and want Hide Pinned to simply remove every pinned row from the list. The pin-to-wait-out-a-regression scenario from #293 is now addressed by simply unchecking Hide Pinned — predictable filter semantics over clever cross-filter logic.
- **[#296](https://github.com/CodesWhat/drydock/issues/296)** (follow-up) — When `docker-socket-proxy` blocks `GET /info` (the default — `INFO=0`), drydock now logs an actionable warning naming the watcher, the error, and the fix (`set INFO=1 on your docker-socket-proxy config, or set DD_SERVER_NAME to override`) instead of silently falling back to the container short ID. The socket-proxy setup doc and compose examples now include `INFO=1` in the required environment variables. Default notification body templates no longer repeat the `[server]` source prefix that already appears in the title — providers that concatenate title + body (Telegram, Slack, Mattermost, Matrix, Teams, Google Chat, Rocket.Chat) are unaffected because source context is carried by the title.
- **[#289](https://github.com/CodesWhat/drydock/issues/289)** — Container rows no longer drop sort position during an in-flight update, and every terminal outcome (succeeded / failed / rolled-back) now fires a toast. The operation display hold captures a sort-field snapshot at hold start so the row stays pinned through the docker recreate window; the active hold extends to 10 minutes with a reconciliation pass after each container-list refresh that collapses the hold back to the 1.5s settle window for any container whose raw status no longer shows an in-progress update (safety net for missed terminal SSEs).
- **[#291](https://github.com/CodesWhat/drydock/issues/291)** — Dashboard update flow now fires the same toast sequence as the Containers view: "Update started" on click (no more premature "updated" message), then "Updated / Update failed / Rolled back" on the terminal state. Wired through the same SSE-driven operation display hold that the Containers view uses.
- **Concurrent dashboard update queueing** — The per-row Update button in the dashboard Recent-Updates widget is no longer disabled by a global `isDashboardBulkUpdateLocked` state whenever any row is updating; each row's button now only disables for its own in-flight state, matching the Containers view and letting users stack additional updates onto the queue while one is in flight.
- **Dashboard updating/queued badge centering** — The Updating/Queued pill on dashboard recent-updates rows now renders as an absolute-positioned row overlay using the shared `dd-row-updating` / `.dd-row-overlay` pattern from the Containers view (badge spans horizontally and vertically centered, rest of the row dims to 30%) instead of as an inline badge next to the container name.
- **`resultChanged` preserved through env redaction** — `classifyContainerRuntimeEnv` previously dropped the non-enumerable `resultChanged` function when spreading into the redacted object, which produced `resultChanged is not a function` at watch time. The function is now re-attached via `Object.defineProperty` after the spread so watcher scans against redacted state continue to work.
- **[#310](https://github.com/CodesWhat/drydock/issues/310)** — Restored the `[server]` / `[agent]` prefix on default notification body templates that rc.10 `30287c24` had stripped. The original refactor reasoned that title already carried the prefix so body duplication was redundant on chat providers like Slack/Telegram; it did not account for **batch email**, where Gmail shows one subject ("N updates available") and a bulleted body, and each bullet needs to self-identify its watcher/host. Email correctness beats chat cosmetic duplication — `DEFAULT_SIMPLE_BODY_DIGEST`, `DEFAULT_SIMPLE_BODY_UPDATE`, `UPDATE_APPLIED_SIMPLE_BODY`, `UPDATE_FAILED_SIMPLE_BODY`, and `SECURITY_ALERT_SIMPLE_BODY` all lead with `container.notificationAgentPrefix` again.

## [1.5.0-rc.10] — 2026-04-18

### Added

- **[#300](https://github.com/CodesWhat/drydock/discussions/300)** — **Security scan digest mode.** Every scan cycle (scheduled cron, on-demand single, or the new bulk `POST /api/v1/containers/scan-all` endpoint) now carries a stable `cycleId` (UUID v7) and emits a `security-scan-cycle-complete` event with `scannedCount` / `alertCount` / `startedAt` / `completedAt` / `scope`. Triggers can configure `SECURITYMODE=digest` (or `batch+digest`) to receive one summary per cycle grouped by severity (critical → high → medium → low → unknown) instead of one notification per container. Templates are customizable via `SECURITYDIGESTTITLE` / `SECURITYDIGESTBODY`. Per-channel `once=true` dedup is tracked under a new `'security-alert-digest'` `NotificationEventKind` so simple / batch / digest channels never stomp on each other (same per-channel pattern introduced for updates in #282). The UI **Scan All** button now issues one bulk-scan request instead of N per-container HTTP calls, so a 40-container inventory produces one email instead of forty.
- **Opt-in scheduled-scan notifications** — New `DD_SECURITY_SCAN_NOTIFICATIONS=true` flag enables `security-alert` event emission from scheduled scans. Default is `false` to preserve pre-rc.10 behavior for existing users; on-demand scans always emit. Scheduled scans always emit the `security-scan-cycle-complete` event regardless of the flag (so audit-log and OpenTelemetry consumers see every cycle, even zero-alert ones).
- **Bulk security scan endpoint** — `POST /api/v1/containers/scan-all` scans all (or a filtered subset of) watched containers server-side, respects a bulk-scan concurrency pool, streams per-container progress over the existing scan SSE channel, emits a single `security-scan-cycle-complete` at the end, and honors client-disconnect aborts. Rate-limited to 1 request / 60s per IP (authenticated-admin bypass).
- **Container source project shortcut link (Discussion #295)** — containers now render a clickable "View project" link next to release notes in detail panels and list cards when an `org.opencontainers.image.source` OCI label, `dd.source.repo` override label, or GHCR-derived source URL is available. The link uses a github/gitlab icon based on host, opens in a new tab, and reuses the existing `sourceRepo` field surfaced by the release-notes enrichment pipeline. No backend changes required.
- **Absolute-timestamp tooltip on watcher next-run column (Discussion #288)** — the "next update check" column on the Watchers/Agents view (already shipped in a prior RC as a relative countdown like "in 14m") now surfaces the absolute local timestamp on hover (`Apr 18, 14:32:07`), mirroring the Last-seen / Created pattern elsewhere in the UI. Primary display remains the live relative countdown; the dual-format improvement lets users correlate the next poll against logs, backups, or other scheduled work without mental arithmetic.
- **Actionable deprecation banners (Discussion #214)** — the 5 deprecation warning banners (legacy `WUD_*` env vars and `wud.*` labels, legacy API paths, curl healthcheck override, legacy password hash, OIDC HTTP discovery) now show the concrete migration action inline (e.g. "Rename `WUD_*` to `DD_*`") and include a "View migration guide" link that deep-jumps to the relevant anchored section of the deprecations docs page instead of the page root. New anchors added to `/docs/deprecations`: `#legacy-env-vars`, `#legacy-labels`, `#legacy-trigger-prefix`, `#legacy-password-hashes`, `#curl-healthcheck-override`, `#oidc-http-discovery`, `#unversioned-api-paths`.
- **Notification dropdown rework + themeable zebra stripes (Discussion #267)** — the notification-bell dropdown has moved to the GitHub/Linear/Slack consensus layout: header carries the "Notifications" title plus a minimal "Clear" text button in the top-right for bulk dismissal, each row grows a per-entry ✕ dismiss affordance (hover-reveal on desktop, always-visible on touch devices via `@media (pointer: coarse)`), and a split footer exposes "Mark all as read" + "Open audit log" as equal-weight actions. Replaces the bulk "Clear all" / "Mark all read" header pair that reporters had flagged as cramped. Dismissed entry IDs persist under `dd-bell-dismissed-ids` in localStorage (audit log is unaffected — the bell is a client-side read model) and Clear hides itself when there's nothing to dismiss. Introduces `--dd-zebra-stripe`, a new theme token derived via `color-mix()` from `--dd-bg-card` + `--dd-text`, so alternate-row striping stays legible on GitHub Dark, GitHub Light, and Ayu Light where the previous `--dd-bg-inset` fallback was visually identical to `--dd-bg-card`. ([#9bccd456](https://github.com/CodesWhat/drydock/commit/9bccd456), [#e823d953](https://github.com/CodesWhat/drydock/commit/e823d953))

### Changed

- **Trigger digest flush DRY refactor** — `flushDigestBuffer` / `shouldHandleDigestContainerReport` are now parameterized on the event kind so update-digest and security-digest share a single implementation, keeping the rc.9 #282 dedup invariants (no cross-channel stomping, per-cycle partitioning) in one place instead of duplicated per feature.

## [1.5.0-rc.9] — 2026-04-17

### Added

- **Notification history store** — New LokiJS collection (`notifications_history`) records a per-(trigger, container, event-kind) result hash so `once=true` dedup survives process restarts and transient `changed=false` scan cycles. Replaces in-memory `notifiedHashes` state that used to disappear on restart, and lets the digest channel maintain its own send history independently of simple/batch channels (see #282). ([#c0054d25](https://github.com/CodesWhat/drydock/commit/c0054d25), [#f79d9ec6](https://github.com/CodesWhat/drydock/commit/f79d9ec6))
- **OIDC redirect target allowlist** — Post-login redirects are now validated against the backend's endpoint allowlist (not origin matching) so OIDC flows cannot be hijacked into landing on arbitrary paths. Works alongside the rc.8 strict-origin / authorization-endpoint match. ([#02c27294](https://github.com/CodesWhat/drydock/commit/02c27294))
- **SPA + hashed-asset cache-control** — Static UI assets with hashed filenames are served with immutable long-lived cache headers, while the SPA `index.html` fallback carries a short revalidation header so deployments are picked up on the next navigation. ([#656e502a](https://github.com/CodesWhat/drydock/commit/656e502a))
- **Label truncation with tooltips across data surfaces** — Long container names, tags, and image references truncate with an ellipsis and surface the full value on hover via the shared tooltip directive (which now falls back to binding text and suppresses the native `title` attribute to avoid browser-UI duplication). ([#dec4ac06](https://github.com/CodesWhat/drydock/commit/dec4ac06), [#38530312](https://github.com/CodesWhat/drydock/commit/38530312))
- **Bounded native container table scroll** — Replaced the virtualized table implementation with a bounded native scroll region that performs predictably at 10k+ rows without the virtualization layout churn that was flagged in rc.7/rc.8 feedback. ([#dfa8ecff](https://github.com/CodesWhat/drydock/commit/dfa8ecff))

### Changed

- ♻️ **refactor(components)** — Component configuration types are now generic across the watcher / registry / trigger / authentication hierarchies, so each component carries its own typed `configuration` instead of the base `Component<T>` forcing `unknown` casts at every call site. ([#89abe357](https://github.com/CodesWhat/drydock/commit/89abe357))
- ♻️ **refactor(registries)** — Public-image credential-fallback logic hoisted into `BaseRegistry` so every provider shares the same "private token failed → retry as public" flow, closing the per-provider drift that was surfacing in rc.8 registry logs. ([#b579d810](https://github.com/CodesWhat/drydock/commit/b579d810))
- ♻️ **refactor(triggers)** — `docker` and `dockercompose` triggers share a single compose bind-mount path remapper so the two code paths cannot drift on how host/container paths map across the agent boundary. ([#4303d876](https://github.com/CodesWhat/drydock/commit/4303d876))
- 🎨 **style(ui)** — Updating table rows dim to 30% opacity to match the card-view treatment, keeping the visual language consistent across both layouts while an update is in-flight. ([#8bcec369](https://github.com/CodesWhat/drydock/commit/8bcec369))

### Fixed

- **[#282](https://github.com/CodesWhat/drydock/issues/282)** — `batch+digest` mode now sends both the immediate batch email and the scheduled morning digest for each detected update, matching the documented semantics. Since rc.7 (`982b4d74`), the batch path was writing a persistent `'update-available'` history hash and evicting the just-buffered container from the digest buffer; on every subsequent scan, `handleContainerReportDigest` silently short-circuited because the shared `once + alreadyNotified` check returned true. The morning cron then fired on an empty buffer and logged `buffer empty, nothing to send`. Fix splits the digest channel off as its own `NotificationEventKind` (`'update-available-digest'`) so batch-channel and digest-channel dedup are independent, removes the cross-channel eviction in `handleContainerReports`, teaches `seedNotificationHistoryFromStore` / `handleContainerUpdateAppliedEvent` about both kinds, and adds a debug log on the previously-silent skip path so operators can actually see why a container didn't make it into the buffer. ([#458030b7](https://github.com/CodesWhat/drydock/commit/458030b7))
- **[#293](https://github.com/CodesWhat/drydock/issues/293)** — Hide Pinned filter no longer hides pinned containers that have a pending update. Reporter pinned `grafana/grafana:12.3.2` to wait out an upstream regression and expected to see `12.3.3` show up as an available update, but the Containers view and the dashboard Updates Available widget both filtered it out because the classifier treats any 3+ numeric-segment semver as pinned. Filter decluttering is preserved for static pinned containers; only rows with a pending update (`newTag` truthy) now surface through the filter. Updates the dashboard `updatesAvailable` stat card and the update breakdown widget to count pinned-with-update rows toward the true total. ([#318d97ab](https://github.com/CodesWhat/drydock/commit/318d97ab))
- **[#298](https://github.com/CodesWhat/drydock/issues/298)** — Remote-agent container updates no longer fail with `HTTP 413 Payload Too Large`. The controller posted the full `Container` object to the agent when executing a `docker` / `dockercompose` trigger, but the agent's 256kb json body cap (introduced as v1.5.0 DoS hardening) started getting exceeded by common payloads once release-notes bodies + env + labels + image metadata grew across the RC cycle. The agent's update handler only dereferences `container.id` (for its own store lookup) and `container.name` (for the rollback-container guard), so the controller now posts just `{ id, name }` for update triggers. Notification triggers still receive the full container so template rendering works. Reporter on Synology DSM 7 saw `Error updating container ... (Request failed with status code 413)` from `agent-client.mediavault`. ([#5d6c76aa](https://github.com/CodesWhat/drydock/commit/5d6c76aa))
- **[#296](https://github.com/CodesWhat/drydock/issues/296)** (reopen) — Controller identity detection now runs for host-based watchers (TCP to a local socket-proxy, the common Synology / Docker Compose pattern), not just pure-socket watchers. Socket-based watchers still take priority, and truly remote watchers can no longer hijack the identity because host-based detection is skipped once a name has already been populated. Reporter saw `[baf1154911ce]` on rc.8 because their Synology setup reaches the daemon via `docker-socket-proxy`, which made the previous `!watcher.configuration.host` gate short-circuit. Workaround for users on rc.8: set `DD_SERVER_NAME`. ([#2143804d](https://github.com/CodesWhat/drydock/commit/2143804d))
- **Trivy DB cache race** — The on-disk Trivy DB cache is now guarded against stale in-flight overrides during concurrent scans, so two scans starting within the same refresh window cannot leave each other with a half-applied database snapshot. ([#89adcc11](https://github.com/CodesWhat/drydock/commit/89adcc11))
- **Malformed `dd.tag.transform` regex patterns** — The regex-transform label validator now throws at config time for malformed or oversized patterns instead of silently producing broken tag transformations that surface as bogus update detections. ([#0a93f113](https://github.com/CodesWhat/drydock/commit/0a93f113))
- **SSE teardown double-run** — Event-stream cleanup listeners register with `{ once: true }` so a client disconnect cannot run teardown twice and briefly emit duplicate metrics / log lines for the same client ID. ([#bcaba6e4](https://github.com/CodesWhat/drydock/commit/bcaba6e4))
- **Updating badge rendering** — Table rows now show a centered Updating badge instead of the tiny inline spinner that was hard to see on dense rows with long container names. ([#fa558167](https://github.com/CodesWhat/drydock/commit/fa558167))
- **Grouped-row Update All lockout** — Starting an update on one container in a stack no longer disables every other row in the same group; only the updating row itself is locked. ([#6c4d10ea](https://github.com/CodesWhat/drydock/commit/6c4d10ea))
- **Modal backdrop z-index** — `z-index` utility classes are now registered as Tailwind `@utility` rules so modal backdrops reliably cover the page instead of getting layered below dashboard widgets on certain themes. ([#7bb26683](https://github.com/CodesWhat/drydock/commit/7bb26683))
- **Containers table 70vh cap** — Dropped the legacy `max-height: 70vh` cap on the containers table so the table fills the viewport like every other data surface, eliminating the phantom whitespace at the bottom of the page on tall displays. ([#d2fceec7](https://github.com/CodesWhat/drydock/commit/d2fceec7))
- **Grouped containers table 70vh cap (regressed in rc.9)** — The bound-scroll fix in rc.9 reintroduced a `max-height="70vh"` cap on the grouped (Stacks) table; removed so it again fills the page like flat view. The DataViewLayout already provides the page-level scroll surface — no nested scroller needed.
- **Table cell vertical alignment** — DataTable cells default to `align-middle` instead of `align-top`. Multi-line name+image cells used to push the row taller than the actions column, leaving the actions floating in the vertical middle while every other cell stuck to the top. Centering everything keeps the row reading as a single horizontal band of metadata.
- **Container icon size in table view** — Container icons in the grouped/flat table bumped from 20px → 32px and the icon column from 40px → 56px so they read at a glance on dense rows.
- **Sidebar nav top padding** — Trimmed the gap between the DRYDOCK brand and the first nav item (Dashboard) from ~14px to ~6px so the brand visually anchors to the nav grid below it instead of floating above empty space.
- **Notification bell dropdown row styling** — Replaced the per-row bottom border with alternating row backgrounds (`var(--dd-bg-card)` / `var(--dd-bg-inset)`), matching the zebra-striped pattern every other data table in the app uses.

### Performance

- **[#301](https://github.com/CodesWhat/drydock/issues/301)** — `GET /api/containers` preloads all active update operations in a single indexed scan and builds per-container id/newId/name lookup maps, replacing the rc.8 per-container 3-scan fan-out. Dashboard / Watchers / Servers / Container Logs views all hit this endpoint, so the synthetic per-attach time drops from ~5–25 ms to ~0.02–0.04 ms on large inventories. ([#76023d15](https://github.com/CodesWhat/drydock/commit/76023d15))
- **Container list projection via Proxy** — The container list response projects each row through a `Proxy` that lazily computes expensive derived fields and drops the redundant `count` query, shaving a second lap through the store per request. ([#ac567d76](https://github.com/CodesWhat/drydock/commit/ac567d76))

### Security

- **[GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)** (critical) — Bumped `protobufjs` 7.5.4 → 7.5.5 in `app/` and `e2e/` lockfiles to close the prototype-chain arbitrary-code-execution advisory. ([#2b473f23](https://github.com/CodesWhat/drydock/commit/2b473f23))
- **[GHSA-r4q5-vmmm-2653](https://github.com/advisories/GHSA-r4q5-vmmm-2653)** (medium) — Bumped `follow-redirects` to 1.16.0 in `app/` lockfile to close the custom-auth-header cross-domain leak advisory. ([#bbda0cd8](https://github.com/CodesWhat/drydock/commit/bbda0cd8))
- **Hook command grammar validator** — User-supplied pre-update / post-update hook commands are now validated against a restricted shell-safe grammar at config time (no `$(...)`, backticks, redirections, or chaining metacharacters) so a hook label cannot escape into arbitrary shell execution. ([#e29d5711](https://github.com/CodesWhat/drydock/commit/e29d5711))
- **OIDC authorization endpoint strict match** — The OIDC flow now requires an exact match against the discovered authorization endpoint and no longer falls back to a broad origin match, closing a redirect-URL substitution surface. ([#e81a4924](https://github.com/CodesWhat/drydock/commit/e81a4924))
- **OIDC token redaction in error logs** — Error log lines from the OIDC pipeline redact bearer / id / refresh tokens so a malformed provider response cannot leak credentials into operator logs. ([#2053a5d8](https://github.com/CodesWhat/drydock/commit/2053a5d8))
- **Rate-limit key derivation** — Unauthenticated rate-limit buckets now key on `socket.remoteAddress` in preference to `request.ip`, eliminating the `X-Forwarded-For` spoof-ability for IP-based buckets when reverse proxies are untrusted. ([#cb36affa](https://github.com/CodesWhat/drydock/commit/cb36affa))
- **CORS origin required when enabled** — Enabling CORS now requires `DD_SERVER_CORS_ORIGIN` to be set explicitly; the previous wildcard default silently allowed any origin when the env var was forgotten. ([#ba82d917](https://github.com/CodesWhat/drydock/commit/ba82d917))
- **Snyk policy refresh** — `.snyk` scope narrowed to the two genuinely-reviewed Code false-positives; non-enforced rules dropped so the policy file stays a real exception ledger rather than a catch-all suppression list. ([#8a2360a9](https://github.com/CodesWhat/drydock/commit/8a2360a9))
- **Trivy pin refresh** — Bumped the Dockerfile `apk add` pin for Trivy from `0.69.3-r2` to `0.70.0-r0` to track Alpine edge/testing. The previous pin started failing builds once edge advanced past it.

## [1.5.0-rc.8] - 2026-04-13

### Added

- **Backend-driven update queue** — Container updates are now queued server-side with per-trigger concurrency limits. UI shows Queued → Updating → Updated state progression with sequence labels (e.g. "Updating 1 of 3"). ([#bacbc1c7](https://github.com/CodesWhat/drydock/commit/bacbc1c7), [#5edc55a2](https://github.com/CodesWhat/drydock/commit/5edc55a2), [#7d7cfdfc](https://github.com/CodesWhat/drydock/commit/7d7cfdfc))
- **Watcher next-run metadata ([#288](https://github.com/CodesWhat/drydock/issues/288))** — Watcher API and Agents view now show when each watcher will next poll for updates. ([#6706929e](https://github.com/CodesWhat/drydock/commit/6706929e))
- **Notification delivery failure audit entries ([#282](https://github.com/CodesWhat/drydock/issues/282))** — Failed notification deliveries appear in the notification bell dropdown. ([#ae5309b3](https://github.com/CodesWhat/drydock/commit/ae5309b3))
- **Container action operations** — Container actions (start, stop, restart, etc.) tracked with dashboard updates. ([#6615ccbf](https://github.com/CodesWhat/drydock/commit/6615ccbf))
- **Identity-keyed container tracking** — Containers tracked by stable identity key (agent::watcher::name) across renames/replacements. Audit events include `containerIdentityKey`. Recent-status API returns `statusesByIdentity` for precise per-container status resolution. ([#8fb75070](https://github.com/CodesWhat/drydock/commit/8fb75070), [#ea413c34](https://github.com/CodesWhat/drydock/commit/ea413c34))
- **Trigger buffer retention and capacity limits** — Digest and batch-retry buffers now enforce a 5,000-entry cap and 7-day retention window, evicting the oldest entries first and pruning stale entries before each access. Prevents unbounded memory growth on long-running controllers. ([#c6a9930c](https://github.com/CodesWhat/drydock/commit/c6a9930c))
- **Update operation recovery phases** — New phases (`recovered-cleanup-temp`, `recovered-rollback`, `recovered-active`, `recovery-failed`, `recovery-missing-containers`) distinguish operations that completed via the deferred reconciliation recovery path from the primary update flow. ([#3ffe2f12](https://github.com/CodesWhat/drydock/commit/3ffe2f12))

### Changed

- **Auth user cache removed** — Replaced TTL-based auth cache with request deduplication only, ensuring logout/session expiry in other tabs is reflected immediately. ([#923e0926](https://github.com/CodesWhat/drydock/commit/923e0926))
- ♻️ **refactor(ui)** — Container update cards now render phase-only queue status, while grouped stack headers own the frozen `X of Y done` batch progress copy for multi-container updates.

### Fixed

- **[#296](https://github.com/CodesWhat/drydock/issues/296)** — Notification server-name prefix no longer renders the container ID on Docker Compose setups. `getServerName()` precedence is now `DD_SERVER_NAME` → detected Docker/Podman daemon host name (from `dockerApi.info().Name`) → `os.hostname()`. Remote watchers never hijack the controller identity. ([#b723369f](https://github.com/CodesWhat/drydock/commit/b723369f))
- **[#286](https://github.com/CodesWhat/drydock/issues/286)** — Stack view column shifting fixed by collapsing all stacks into a single table. ([#2f511d33](https://github.com/CodesWhat/drydock/commit/2f511d33))
- **[#283](https://github.com/CodesWhat/drydock/issues/283)** — Duplicate server name in notification prefix and suffix suppressed. ([#aaf9962d](https://github.com/CodesWhat/drydock/commit/aaf9962d))
- **[#270](https://github.com/CodesWhat/drydock/issues/270)** — Hide-pinned filter now uses computed `tagPinned` property instead of stale stored field. Unconditional startup repair ensures tagPrecision data is always correct. ([#c7ecceef](https://github.com/CodesWhat/drydock/commit/c7ecceef), [#0949a142](https://github.com/CodesWhat/drydock/commit/0949a142))
- **[#291](https://github.com/CodesWhat/drydock/issues/291)** — Dashboard update widget now uses the same update-start semantics as containers view (shows "Updating" toast, not "Updated"). ([#c9f21a7b](https://github.com/CodesWhat/drydock/commit/c9f21a7b))
- **[#290](https://github.com/CodesWhat/drydock/issues/290)** — Update-applied success events preserved across Docker container rename race. ([#6b5c1f72](https://github.com/CodesWhat/drydock/commit/6b5c1f72))
- **[#289](https://github.com/CodesWhat/drydock/issues/289)** — Standalone (non-queued) update state transitions restored after queue-aware changes broke them in rc.7. ([#2b00c4b8](https://github.com/CodesWhat/drydock/commit/2b00c4b8))
- **[#287](https://github.com/CodesWhat/drydock/discussions/287)** — Custom healthcheck backward compatibility restored. The built-in `/bin/healthcheck` remains the default image probe and now handles TLS backends, while `curl` is again present in the Docker image for user-defined custom `healthcheck:` overrides during the v1.5.x deprecation window. v1.6.0 is the final warning release, and removal is now scheduled for v1.7.0. ([#414f0170](https://github.com/CodesWhat/drydock/commit/414f0170))
- **[#282](https://github.com/CodesWhat/drydock/issues/282)** — Digest buffer evicted after batch send; watcher events awaited for handler ordering; batch send retry with delivery failure audit; agent remote report events awaited. ([#982b4d74](https://github.com/CodesWhat/drydock/commit/982b4d74), [#0594e971](https://github.com/CodesWhat/drydock/commit/0594e971), [#c31f78eb](https://github.com/CodesWhat/drydock/commit/c31f78eb), [#1ac7c36d](https://github.com/CodesWhat/drydock/commit/1ac7c36d))
- **[#276](https://github.com/CodesWhat/drydock/issues/276)** — Dashboard update tracking keyed by container ID instead of name. ([#c81e25a8](https://github.com/CodesWhat/drydock/commit/c81e25a8))
- **[#256](https://github.com/CodesWhat/drydock/issues/256)** — Pending update state scoped by stable container identity, preventing cross-contamination between same-name containers on different hosts. ([#05c023fe](https://github.com/CodesWhat/drydock/commit/05c023fe))
- **[#253](https://github.com/CodesWhat/drydock/issues/253)** — Shorthand trigger references resolved in notification rule matching; notification buffering keys stabilized; debug logging added to every silent filter path. ([#ba6341b4](https://github.com/CodesWhat/drydock/commit/ba6341b4), [#d475d33c](https://github.com/CodesWhat/drydock/commit/d475d33c), [#bb1550e4](https://github.com/CodesWhat/drydock/commit/bb1550e4))
- **[#248](https://github.com/CodesWhat/drydock/issues/248)** — API guard against duplicate container updates (409 conflict). ([#110aae36](https://github.com/CodesWhat/drydock/commit/110aae36))
- **[#217](https://github.com/CodesWhat/drydock/issues/217)** — Vulnerability rows top-aligned in detail panels. ([#431be5ea](https://github.com/CodesWhat/drydock/commit/431be5ea))
- **Expired update operations** — Executor revives expired pre-created operations instead of inserting duplicate rows. ([#04e847ef](https://github.com/CodesWhat/drydock/commit/04e847ef))
- **Static asset throttling** — SPA fallback rate limiter no longer throttles static assets. ([#bfe52038](https://github.com/CodesWhat/drydock/commit/bfe52038))
- **Compound rolling tag aliases misclassified as pinned** — `isTagPinned` now treats aliases like `latest-alpine`, `stable_arm64`, and `dev.build` as floating even when their suffixes contain digits. ([#da613f70](https://github.com/CodesWhat/drydock/commit/da613f70))

### Performance

- **Virtual scrolling for grouped containers table** — Grouped container tables no longer render every row eagerly, keeping the DOM light on deployments with many containers. ([#606d5cc0](https://github.com/CodesWhat/drydock/commit/606d5cc0))

### Security

- **Axios CVE-2025-62718** — Updated axios 1.13.6 → 1.15.0. ([#c4af5e4a](https://github.com/CodesWhat/drydock/commit/c4af5e4a))
- **Healthcheck HTTPS probe hardening** — `/bin/healthcheck` no longer uses `popen()` with shell command interpolation to invoke `openssl`. The probe now locates the openssl binary explicitly, fork/execs it with pipes, and uses poll-driven I/O with SIGPIPE handling — eliminating any shell injection surface. ([#0173d7ed](https://github.com/CodesWhat/drydock/commit/0173d7ed))
- **SSE log IP hashing with opt-in raw mode** — SSE connect/disconnect lines and per-IP rate-limit warnings now log the internal client ID plus a salted hash of the source IP (`h:xxxxxxxx`) by default. The hash salt rotates on every process start, so hashed identifiers cannot be correlated across restarts and raw addresses never touch the log. Operators troubleshooting a specific connection issue can set `DD_SSE_DEBUG_LOG_IP=true` to temporarily log raw IPs. ([#9e236745](https://github.com/CodesWhat/drydock/commit/9e236745))
- **HTTP trigger proxy URL scheme validation** — HTTP trigger proxy URLs must now be `http://` or `https://` schemes. Invalid schemes are rejected at config-validation time and fail closed at runtime instead of silently constructing a broken proxy. ([#981f7f8e](https://github.com/CodesWhat/drydock/commit/981f7f8e))
- **Vulnerability CSV export escape hardening** — Every CSV field (including column headers) is now quoted unconditionally, and tab/CR leading characters are escaped alongside `=+-@` to fully close the CSV formula-injection surface. ([#95de9f0e](https://github.com/CodesWhat/drydock/commit/95de9f0e))
- **Snyk policy file** — Added a repo-level `.snyk` file so reviewed false-positive Snyk Code findings are silenced with a mandatory reason and expiry date alongside the code, instead of in PR comments. Initial entries cover the ephemeral session-secret generator and the UI static file sink flagged via `process.argv[1]` taint. ([#61f49606](https://github.com/CodesWhat/drydock/commit/61f49606))
- **Supply-chain toolchain refresh** — Bumped pinned Alpine edge/testing package versions for `cosign` (2.4.3-r12) and `trivy` (0.69.3-r2) in the Dockerfile to track upstream security fixes. ([#b542eb15](https://github.com/CodesWhat/drydock/commit/b542eb15))

### Internal

- **Exact-version package.json pinning** — Flipped the four remaining caret specifiers (`nodemailer`, `@biomejs/biome`, `lefthook`, `lodash`) to exact versions so every package.json matches the already-exact lockfile resolutions and Renovate cannot pull in-range bumps without a PR. Every dependency layer is now SHA-immutable: npm via lockfile integrity hashes, Docker base images via `@sha256:` digests, and GitHub Actions via 40-char commit SHAs. ([#23b7fcfd](https://github.com/CodesWhat/drydock/commit/23b7fcfd))
- **Regression test coverage** — Closed the remaining app + UI coverage gaps flagged by the pre-push gate, including guard branches in `detectLocalDaemonServerName`, `useOperationDisplayHold`, `useContainerFilters`, `preferences/migrate`, services `logs` and `system-log-stream`, and `useContainerPolicy`. ([#58932e40](https://github.com/CodesWhat/drydock/commit/58932e40), [#9f238be5](https://github.com/CodesWhat/drydock/commit/9f238be5), [#72d6d688](https://github.com/CodesWhat/drydock/commit/72d6d688))

## [1.5.0-rc.7] — 2026-04-08

### Added

- **Multi-server notification identification (#283)** — Notifications automatically include a `[server-name]` prefix when agents are registered, identifying which server (controller or agent) each update comes from. Controller name configurable via `DD_SERVER_NAME` (defaults to `os.hostname()`). Custom templates can use `container.notificationServerName` and `container.notificationAgentPrefix`. ([#14365870](https://github.com/CodesWhat/drydock/commit/14365870), [#5880b4c8](https://github.com/CodesWhat/drydock/commit/5880b4c8))
- **Infrastructure update mode** — `dd.update.mode=infrastructure` label for socket proxy containers enables helper-swap update path bypassing the socket proxy. ([#0e8f620d](https://github.com/CodesWhat/drydock/commit/0e8f620d))

### Changed

- **SSE debug logging** — Connect/disconnect log messages now include client ID and IP address. ([#12942ee4](https://github.com/CodesWhat/drydock/commit/12942ee4))

### Security

- **Vite CVE patches** — Updated vite to 8.0.7 (ui) and 7.3.2 (demo) to fix CVE-2026-39363, CVE-2026-39364, CVE-2026-39365 (dev server file read vulnerabilities). ([#15abb919](https://github.com/CodesWhat/drydock/commit/15abb919))

## [1.5.0-rc.6] — 2026-04-05

### Added

- **Rollback shortcut in container actions menu** — Quick rollback option directly from the container row actions dropdown. ([#5137b99a](https://github.com/CodesWhat/drydock/commit/5137b99a))
- **Clear all button in notification bell** — One-click dismiss of all notification bell entries. ([#6785e2a4](https://github.com/CodesWhat/drydock/commit/6785e2a4))
- **Info toast when no pending update** — Container update check now shows an informational toast when the container is already at its latest version. ([#08864936](https://github.com/CodesWhat/drydock/commit/08864936))
- **Typed notification event templates** — Every event type (update-available, update-applied, update-failed, security-alert, agent-reconnect) now has a dedicated default template with type-safe variable placeholders. ([#69f85c36](https://github.com/CodesWhat/drydock/commit/69f85c36))
- **Digest-aware default notification templates** — Default templates now indicate when a notification was delivered via digest accumulation. ([#f7668d44](https://github.com/CodesWhat/drydock/commit/f7668d44))
- **Structured dispatch decisions with digest routing** — Trigger dispatch returns structured decision objects with digest routing warnings for debugging notification flow. ([#fd82adc8](https://github.com/CodesWhat/drydock/commit/fd82adc8))
- **Agent SSE event relay** — Controller now relays `update-applied`, `update-failed`, and `security-alert` events from remote agents over SSE to connected UI clients. ([#f497ac75](https://github.com/CodesWhat/drydock/commit/f497ac75))
- **Implicit all-triggers semantics label** — Notification rule editor shows helper text when an `update-available` rule implicitly applies to all triggers. ([#ba43a870](https://github.com/CodesWhat/drydock/commit/ba43a870))

### Changed

- **Responsive dashboard layout persistence** — Dashboard widget bounds and layout are now breakpoint-aware, persisting separate layouts per viewport tier. ([#d16a3d0f](https://github.com/CodesWhat/drydock/commit/d16a3d0f), [#2deac1c3](https://github.com/CodesWhat/drydock/commit/2deac1c3))
- **Tag precision module consolidation** — `TagPrecision` type and numeric tag shape parser deduplicated into `tag/precision` module. ([#857fcb7a](https://github.com/CodesWhat/drydock/commit/857fcb7a), [#f2cc81e0](https://github.com/CodesWhat/drydock/commit/f2cc81e0))
- **Trigger notification internals** — Extracted notification event helpers, hoisted default templates, type-safe container access in store. ([#3e81f378](https://github.com/CodesWhat/drydock/commit/3e81f378), [#42f5c7aa](https://github.com/CodesWhat/drydock/commit/42f5c7aa))
- **Outlined button styling** — Filled background and improved contrast for outlined action buttons across all views. ([#b901295e](https://github.com/CodesWhat/drydock/commit/b901295e), [#898b6195](https://github.com/CodesWhat/drydock/commit/898b6195))
- **Axios supply chain advisory retired** — Removed from README and website security documentation. ([#c782d3dc](https://github.com/CodesWhat/drydock/commit/c782d3dc))

### Fixed

- **#270** — Hide-pinned filter now applies to dashboard update widgets; `tagPrecision` backfilled for existing containers on migration. ([#f2e36ce4](https://github.com/CodesWhat/drydock/commit/f2e36ce4), [#972f7af1](https://github.com/CodesWhat/drydock/commit/972f7af1))
- **#271** — Log sort order persists across navigation. ([#dbc42186](https://github.com/CodesWhat/drydock/commit/dbc42186))
- **#265** — Stale update detection suppressed from pre-clear watcher scans. ([#06e8a4ee](https://github.com/CodesWhat/drydock/commit/06e8a4ee))
- **#217** — Data rows top-aligned with scroll containment for container views. ([#a97bd0a9](https://github.com/CodesWhat/drydock/commit/a97bd0a9))
- **Dashboard mobile responsive layout** — Recent updates widget layout fixed on mobile viewports. ([#e686bdef](https://github.com/CodesWhat/drydock/commit/e686bdef))
- **Dashboard layout hardening** — Unknown widgets handled gracefully; unnecessary re-renders suppressed. ([#37a33a80](https://github.com/CodesWhat/drydock/commit/37a33a80))
- **Preference persistence on page exit** — Pending dashboard layout and preference writes flushed on `pagehide` and `visibilitychange`. ([#554b7c37](https://github.com/CodesWhat/drydock/commit/554b7c37), [#1cffd21e](https://github.com/CodesWhat/drydock/commit/1cffd21e))
- **Disabled button hover affordance** — Disabled outlined buttons no longer show hover state. ([#89ca53d3](https://github.com/CodesWhat/drydock/commit/89ca53d3))
- **Tag precision backfill guard** — `tagPrecision` backfill skipped when upgrading past v1.5.0. ([#9deb3ba1](https://github.com/CodesWhat/drydock/commit/9deb3ba1))
- **Tag shape parser crash** — `getNumericTagShape` guarded against undefined `transformTag` result. ([#eedc01bf](https://github.com/CodesWhat/drydock/commit/eedc01bf))
- **Digest buffer stale entries** — Container name canonicalized before digest buffer eviction; stale entries evicted before flush. ([#547a3f15](https://github.com/CodesWhat/drydock/commit/547a3f15), [#2776a2d6](https://github.com/CodesWhat/drydock/commit/2776a2d6))
- **Digest buffer type safety** — `flushDigestBuffer` store container map typed as `Container`. ([#d256e3af](https://github.com/CodesWhat/drydock/commit/d256e3af))

### Performance

- **Log viewer cache** — Incremental newest-first cache for log viewer avoids full re-sort on new entries. ([#3340b7c1](https://github.com/CodesWhat/drydock/commit/3340b7c1))
- **Vulnerability list URL memoization** — Safe URL computation memoized to avoid redundant parsing. ([#d9bcbe5d](https://github.com/CodesWhat/drydock/commit/d9bcbe5d))

### Security

- **Vulnerability URL and CSV sanitization** — Vulnerability URLs validated before rendering; CSV export fields sanitized against formula injection. ([#c9ecf1e6](https://github.com/CodesWhat/drydock/commit/c9ecf1e6))

## [1.5.0-rc.5] — 2026-04-04

### Added

- **System log viewer overhaul** — Toolbar stays pinned at top (only log entries scroll), long lines wrap at viewport width, search matches component/level/channel fields, filter toggle (funnel icon) shows only matching entries, sort toggle switches between oldest-first and newest-first, auto-apply filters (no Apply/Reset buttons), copy button floats top-right of log content area, log entry columns aligned with fixed-width component and right-aligned line numbers. ([#259](https://github.com/CodesWhat/drydock/discussions/259), [#260](https://github.com/CodesWhat/drydock/discussions/260), [#263](https://github.com/CodesWhat/drydock/discussions/263), [#251](https://github.com/CodesWhat/drydock/discussions/251))
- **Log component dropdown** — Component filter replaced with a `<select>` dropdown populated from new `GET /api/v1/log/components` endpoint that returns unique component names from the log buffer.
- **Hide Pinned containers toggle** — Checkbox in the container list filter bar hides containers pinned to specific versions (`tagPrecision: specific`). Persisted in user preferences. ([#250](https://github.com/CodesWhat/drydock/discussions/250))
- **Combined batch+digest notification mode** — Triggers can now use `MODE=batch+digest` to send both immediate batch emails and scheduled digest summaries. ([#254](https://github.com/CodesWhat/drydock/issues/254))
- **Conditional reset button** — A reset icon appears in the system log toolbar only when level, tail, or component filters differ from defaults.
- **Security scan export** — Detail panel has export controls (CSV/JSON) for vulnerability reports and SBOM download at the top of the panel. ([#269](https://github.com/CodesWhat/drydock/discussions/269))

### Changed

- **Container filter labels** — Default dropdown options renamed for clarity: "Status" → "All Statuses", "Host" → "All Hosts", "Registry" → "All Registries", "Update" → "All Containers". ([#247](https://github.com/CodesWhat/drydock/discussions/247))
- **Log viewer icons** — Pause, Pin, Sort, Filter, and Copy icons use the theme-aware icon map, so they change when the user switches icon themes in settings.

### Fixed

- **#248** — Update operation state survives container ID change during replacement updates (`newContainerId` lookup).
- **#241** — Temporary rollback containers (`-old-{timestamp}`) hidden from container list API responses.
- **#253** — `threshold=all` honored before rejecting `updateKind=unknown` in notification dispatch.
- **#256** — Update operation state disambiguated by container ID instead of name (prevents cross-host bleed).
- **#257** — Non-dashboard views (Containers, Security, Agents) refresh on SSE reconnect.
- **#258** — Edge-to-edge scroll surface on DataViewLayout for mobile touch.
- **#217** — Content-aware mode threshold for Host Status widget (full mode only when viewport fits all rows).
- **#262** — Registry log calls use component child logger with image name context.
- **#255** — Container event handler schedules refresh for any unknown-to-store container, not just renames.
- **#269** — SBOM download button was silently failing unless the "View SBOM" toggle was active; now serializes directly.
- **BaseRegistry** — Trusted host validation and `getImagePublishedAt` tag object creation hardened.
- **ECR** — Public gallery hostname matching uses parsed URL comparison; private auth token structure validated before split.

## [1.5.0] — 2026-03-19

### Added

- **Up-to-date and pinned badges in Kind column** — Containers table now shows a green check-circle badge ("Up to date") for containers at their latest version, and a green pin badge ("Pinned") for containers with skipped updates, replacing the previous dash placeholder.

- **Real-time container log viewer** — WebSocket-based live log streaming from Docker containers directly in the UI. Features ANSI color rendering, automatic JSON log detection with syntax-highlighted pretty-printing, free-text and regex search with match navigation, stdout/stderr stream filtering, log level filtering for structured logs, copy to clipboard, and gzip-compressed download. Available in both the container detail panel and a dedicated full-page view at `/containers/:id/logs`. ([Phase 4.2](https://getdrydock.com/docs/configuration/logs))
- **Diagnostic debug dump** — One-click export of redacted system state from Configuration > Diagnostics. Collects runtime metadata, component state (watchers, registries, triggers, agents), Docker API diagnostics, MQTT Home Assistant sensors, recent Docker events, store stats, and `DD_*` environment variables. Sensitive values matching `password|token|secret|key|hash` are automatically redacted. Configurable time window (1–1440 minutes). ([Phase 4.14](https://getdrydock.com/docs/api/container))
- **Container log streaming API** — `WS /api/v1/containers/:id/logs/stream` endpoint with Docker binary stream demultiplexing, session-based authentication on WebSocket upgrade, and fixed-window rate limiting (1,000 connections per 15 minutes).
- **Container log download API** — `GET /api/v1/containers/:id/logs` endpoint with gzip compression support, stdout/stderr filtering, configurable tail size, and timestamp-based `since` filtering.
- **Debug dump API** — `GET /api/v1/debug/dump` endpoint with configurable `minutes` query parameter for time-windowed event collection.
- **Copy logs to clipboard** — Copy button in the container log viewer copies all visible log entries to clipboard with timestamp, stream type, and content.
- **Dashboard customization** — Customizable grid layout with drag-to-reorder, resize, and per-widget visibility toggles using `grid-layout-plus`. Edit mode via pencil icon in breadcrumb header. Customize panel with checkboxes and S/M/L size badges. All widgets progressively collapse content based on container height.
- **Resource usage dashboard widget** — CPU and memory usage bars with top-N resource consumers, progressive detail at different widget sizes.
- **Trigger environment variable aliases** — Triggers can now be configured with `DD_ACTION_*` or `DD_NOTIFICATION_*` prefixes in addition to `DD_TRIGGER_*`. All three prefixes resolve identically at startup.
- **Digest notification mode** — New `MODE=digest` trigger option that accumulates update events over a configurable time window and sends a single batch notification on a cron schedule. Configure with `DD_TRIGGER_{type}_{name}_MODE=digest` and `DD_TRIGGER_{type}_{name}_DIGESTCRON=0 8 * * *` (default: daily at 8am). Works with all notification triggers (SMTP, Telegram, Slack, Pushover, etc.). ([Discussion #185](https://github.com/CodesWhat/drydock/discussions/185))
- **Toast notifications for all container actions** — Every container action (update, start, stop, restart, scan, delete, group update, rollback, trigger run) now shows a success toast. Error toasts for failures. Toasts auto-dismiss after 6 seconds. ([#183](https://github.com/CodesWhat/drydock/issues/183), [#193](https://github.com/CodesWhat/drydock/discussions/193))
- **"View containers" navigation from Watchers and Agents** — Detail panels now include a button that navigates directly to the container list filtered by the selected host. ([#194](https://github.com/CodesWhat/drydock/discussions/194))
- **Podman API version negotiation** — Docker watcher probes the daemon's `/version` endpoint over the Unix socket and pins Dockerode to the reported API version. Prevents `EAI_AGAIN` crashes caused by `docker-modem`'s redirect-following bug when Podman returns HTTP 301 for unversioned API paths. ([#182](https://github.com/CodesWhat/drydock/issues/182))
- **System log live streaming in UI** — Added end-to-end WebSocket support for system logs (`/api/v1/log/stream`) with new UI service/composable and live log view integration.
- **Watcher run-time visibility in UI** — Watcher metadata now exposes `lastRunAt`, and UI surfaces it as a relative timestamp.
- **Shared log viewer primitives** — Added reusable `AppLogViewer` building blocks, JSON tokenizer/search utilities, and full-page container detail tab components for consistent log UX.
- **Bearer token auth for `/metrics` endpoint** — Set `DD_SERVER_METRICS_TOKEN` to authenticate Prometheus scrapers via `Authorization: Bearer <token>` without requiring session/basic auth. Uses SHA-256 hashing with timing-safe comparison. Three auth modes: (1) bearer token when token is set, (2) session/basic auth fallback, (3) no auth when `DD_SERVER_METRICS_AUTH=false`.
- **Design system components** — Added shared UI building blocks: `AppIconButton` (icon-only button with WCAG 2.5.8 touch targets), `AppBadge` (tone-based badge with size/uppercase/dot props), `StatusDot` (semantic status indicator), `DetailField` (label+value pair), and `AppTabBar` (v-model tab bar with icons, counts, compact mode). Migrated dashboard, container, settings, layout, and config views to use the new components. ([Discussion #199](https://github.com/CodesWhat/drydock/discussions/199))
- **Floating tag detection and UI indicator** — New `tagPrecision` classifier (`specific` | `floating`) detects mutable version aliases (e.g. `v3`, `1.4`) and auto-enables digest watching on non-Docker Hub registries. Container detail views show a caution badge when a floating tag is detected without digest watching enabled. ([Discussion #178](https://github.com/CodesWhat/drydock/discussions/178))
- **Notification bell action filtering** — Audit log endpoint now supports an `actions` query parameter for comma-separated event type filtering. `NotificationBell` uses this to fetch only actionable alert types instead of the full audit log.
- **Semantic typography utility classes** — Added `dd-text-label`, `dd-text-body`, `dd-text-heading-panel`, and related Tailwind utility classes for consistent text sizing across views.
- **Disable default local watcher** — Set `DD_LOCAL_WATCHER=false` to prevent the built-in Docker watcher from starting, useful for controller-only nodes that manage remote agents exclusively.
- **Container row dimming during actions** — Container table rows dim with reduced opacity while an action (update, restart, etc.) is in progress, providing clear visual feedback. ([#227](https://github.com/CodesWhat/drydock/issues/227))

### Changed

- **Container log viewer upgraded to WebSocket streaming** — Replaced the previous HTTP polling-based log viewer with real-time WebSocket streaming. Logs now appear instantly as containers produce them, with no polling interval needed. The viewer retains up to 5,000 lines in a ring buffer.
- **Container detail panel log tab sizing** — Log viewer in the slide-in detail panel and full-page view now fills the available viewport height without causing outer scrollbars. Uses proper flex layout containment instead of fixed `calc()` heights.
- **Search match navigation** — Prev/Next search navigation buttons are now hidden by default and only appear when a search query is active, reducing toolbar clutter.
- **UI text and margin standardization** — Consistent text sizing, view margins, and scroll container padding across all views and components.
- **Connection lost overlay z-index** — Overlay now covers entire viewport including sidebar using CSS custom property `--z-modal`.
- **Deprecation banner composable** — Reusable `useDeprecationBanner` composable for session and permanent dismissal of deprecation notices.
- **Debug dump redaction patterns expanded** — Sensitive key detection now covers 14+ token patterns including `passwd`, `credential`, `apikey`, `accesskey`, `privatekey`, `bearer`, `auth`, and `login` (env-style keys only for auth/bearer/login to avoid false positives).
- **Lefthook pre-push Playwright gate** — Added `e2e-playwright` to the root pre-push pipeline so local hooks now run Cucumber E2E and Playwright QA before push.
- **Trigger rename migration CLI support** — `config migrate` now supports `--source trigger` and rewrites legacy trigger prefixes (`DD_TRIGGER_*`, `dd.trigger.include`, `dd.trigger.exclude`) to action-prefixed aliases.
- **Centralized rollback container guard** — `-old-{timestamp}` container rejection moved from Docker trigger to base Trigger class, covering all trigger types.
- **Container list query internals modularized** — Extracted query-validation logic and split tests by concern.
- **Container list filtering performance** — Status/kind filters avoid unnecessary full-collection loads; age/created sorting precomputes values.
- **Healthcheck execution path optimized** — Default HEALTHCHECK probe replaced with a 65KB static C binary (`/bin/healthcheck`). curl is retained for backward compatibility with user-defined HEALTHCHECK overrides during the deprecation window and is now scheduled for removal in v1.7.0, with v1.6.0 as the final warning release.
- **Watcher event logging noise reduced** — First event-stream reconnect downgraded from `warn` to `info`.
- **CI workflows renamed** — Dropped numeric prefixes from workflow filenames for clarity.
- **Smoke load test profile removed** — Replaced with the ci profile for meaningful regression detection.
- **Container-update event deduplication** — Added `hasContainerChanged()` to detect meaningful state differences between existing and incoming container records. Suppresses redundant SSE `container-updated` events when a poll cycle returns identical data.
- **Log viewer layout improvements** — Log entries now use `white-space: nowrap` for single-line scannable output (horizontal scroll for overflow), row alignment changed to `items-center` for consistent baselines, and the terminal has a `min-h-[300px]` floor. Log viewer fills container height with `flex-1`, removed line separators, and added dark background on search input.
- **AppIconButton toolbar size** — Added `toolbar` size variant (w-8 h-8, 15px icon) for dense filter bars.
- **Deprecation banner actions layout** — Migration guide link, Dismiss button, and "Don't show again" checkbox stacked vertically with checkbox-gated permanent dismiss.
- **Dashboard customize panel responsive on mobile** — Panel is opt-in on mobile (sliders icon to open), full-screen overlay with backdrop dismiss. Desktop behavior unchanged. ([#222](https://github.com/CodesWhat/drydock/issues/222))
- **Socket version probe hardened** — Added 64KB body cap on socket probe response, timer cleanup via `onScopeDispose`/`onUnmounted`, and typed `gridLayout` as `PersistedLayoutItem[]`.
- **Action trigger default mode** — Action triggers (`docker`, `dockercompose`, `command`) now default to `auto=oninclude` instead of `auto=all`, requiring an explicit `dd.trigger.include` label before auto-updating containers. ([#213](https://github.com/CodesWhat/drydock/issues/213))
- **Agent reconnect notification** — New opt-in `agent-reconnect` notification rule that fires when a remote agent reconnects after losing connection. Disabled by default.
- **Auth lockout hardening** — Expired unlocked entries cleaned proactively, max tracked identities configurable via `DD_AUTH_LOCKOUT_MAX_TRACKED_IDENTITIES`.

### Fixed

- **Telegram MarkdownV2 escaping in all trigger paths** — Body text in `trigger()` and `triggerBatch()` was not escaped for MarkdownV2 reserved characters (`.`, `-`, `(`, `)`, `>`, etc.), causing Telegram API 400 errors and silent notification failures. Now all paths escape via a format-aware helper. ([Discussion #211](https://github.com/CodesWhat/drydock/discussions/211))
- **Dashboard edit-mode dashed borders clipped at grid edges** — Replaced CSS `outline` with `::before` pseudo-element for edit-mode dashed borders; outlines were clipped by ancestor `overflow-hidden` on items at grid edges. Also matched grid negative margins to responsive breakpoints (mobile 10px, tablet 14px, desktop 16px).
- **DataTable icon column clipping on mobile** — Removed `overflow-hidden` from icon-type table columns that was clipping container icons on narrow viewports.
- **Version column alignment on mobile** — Recent updates widget mobile version text now centers and truncates with tooltip instead of left-aligning with `break-all`.
- **Competitor comparison page accuracy** — Corrected WUD registry count (13→10), Watchtower lifecycle hooks verdict (tie→drydock advantage), Portainer RAM footprint (~200MB+→~100–200MB), Dockhand scanning feature name (Update Bouncer→Safe-Pull Protection).
- **TypeScript type safety in watcher registry lookups** — Replaced unsafe `as unknown as` casts with `isDockerWatcher()` type guard for Docker watcher state lookups.
- **Container alias name canonicalization** — `getContainerName()` now strips Docker recreate alias prefixes (e.g. `8bf70beac570_termix` → `termix`) before the name enters the store, so all triggers (Telegram, Slack, Pushover, etc.) receive canonical names. MQTT was already fixed in v1.4.5; this extends the fix to the source. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **Cascading -old container updates** — "Update All" batch no longer triggers updates on containers renamed with `-old-{timestamp}` suffix during a prior update. Guard added to base Trigger class (`mustTrigger`), all API endpoints (container-actions, webhook, trigger proxy), and UI batch freezes container IDs at start. ([#183](https://github.com/CodesWhat/drydock/issues/183))
- **Remote trigger error reporting** — Agent-side trigger endpoints now return structured error details with reason field. Controller extracts and logs the actual failure message instead of bare "Request failed with status code 500". Original Axios error preserved for proxy forwarding. ([#183](https://github.com/CodesWhat/drydock/issues/183))
- **Dashboard confirm dialog** — `ConfirmDialog` moved to global app shell so update prompts from the dashboard "Updates Available" widget appear immediately instead of requiring navigation to the Containers page. ([#184](https://github.com/CodesWhat/drydock/issues/184))
- **Registry failures in Updates Available widget** — Containers with "check failed" status (registry errors) no longer appear in the dashboard "Updates Available" section. They remain visible on the Containers page with error indicators. ([#186](https://github.com/CodesWhat/drydock/issues/186))
- **Digest buffer stale entry eviction** — Containers evicted from digest buffer when update-applied events fire, preventing already-updated containers from appearing in the next digest flush.
- **Rate-limiter memory safety** — Fixed-window limiter now enforces a hard `maxEntries` cap to prevent unbounded growth.
- **UI interaction polish** — Fixed agent column picker positioning ([#187](https://github.com/CodesWhat/drydock/issues/187)), dashboard mobile stacking, Escape-key dashboard edit exit, popover z-index/positioning.
- **Watcher "Last Run" display** — Watchers page now shows relative timestamps for last run. ([#189](https://github.com/CodesWhat/drydock/issues/189))
- **Duplicate containers after recreate** — Three-layer deduplication filtering prevents alias containers from entering the store during Docker recreate cycles. ([#180](https://github.com/CodesWhat/drydock/issues/180))
- **Agent disconnect notification template** — Agent disconnect events now use a dedicated notification template instead of being rendered as container updates. ([#195](https://github.com/CodesWhat/drydock/issues/195))
- **Digest-only image visibility** — Watchers no longer silently drop containers with digest-only image references (e.g. Portainer agent). ([#192](https://github.com/CodesWhat/drydock/issues/192))
- **Digest cron validation** — `DIGESTCRON` config validated with `cron.validate()` at registration time, failing with a clear error instead of a runtime crash.
- **Container list runtime status filtering** — Container list API now accepts Docker runtime statuses (`running`, `stopped`, `paused`, etc.) in `status` filtering.
- **Debug dump filename normalization** — Debug exports now use date-only `.json` filenames.
- **Dashboard widget mobile scroll** — Added `overscroll-contain` to all scrollable dashboard widgets so touch scrolling stays within the widget instead of scrolling the page. ([#200](https://github.com/CodesWhat/drydock/issues/200))
- **WebSocket robustness fixes** — Prevented writes on closed sockets, fixed non-matching upgrade URL pass-through behavior, and eliminated stats-collector listener leaks across restart cycles.
- **Official image pretty logs restored by default** — The release Docker image now defaults to `DD_LOG_FORMAT=text`, restoring human-readable `docker logs` output by default. Set `DD_LOG_FORMAT=json` explicitly if you want structured log output. ([Discussion #221](https://github.com/CodesWhat/drydock/discussions/221))
- **CalVer zero-padded month in strict family filter** — Tags like `2026.02.0` were rejected when the current tag was `2025.11.1` because zero-padded single digits (`01`–`09`) were treated as a family mismatch. Normal in CalVer month fields. ([#202](https://github.com/CodesWhat/drydock/issues/202))
- **Dashboard updates widget 6-item cap** — Removed hard-coded `RECENT_UPDATES_LIMIT` that silently dropped entries beyond 6 in the Updates Available widget. The scroll container was already in place. ([#208](https://github.com/CodesWhat/drydock/issues/208))
- **Disabled tooltip regression** — Restored pointer events on disabled `AppIconButton` so tooltips still explain why actions are unavailable (regressed lock button explanations in grouped views).
- **AppTabBar accessibility** — Added `aria-label` in `iconOnly` mode so tabs are identifiable to assistive technology when visible labels are hidden.
- **OpenAPI `/metrics` security spec** — Removed anonymous `{}` from security alternatives; runtime requires auth by default, spec should not advertise otherwise.
- **Missing filter icon in DataFilterBar** — Restored `AppIconButton` import that was silently swallowed by Vue, making the filter icon invisible on all pages.
- **Missing component imports** — Added missing imports in `SecurityEmptyState` and `AgentsView` that were silently dropped.
- **tagPrecision mapper type safety** — Removed `as any` cast from tagPrecision container mapper.
- **AppIconButton tooltip type** — Widened tooltip prop type and fixed ThemeToggle dead branch.
- **Docker recreate alias prefix stripping unconditional** — Container names are now unconditionally stripped of `hex12_` prefixes at both watcher and trigger level, preventing alias names like `fcdb966987a0_termix` from leaking into notifications. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **Banner checkbox label text invisible** — "Don't show again" text on deprecation banners was unreadable because `dd-text-muted` was used on a `color-mix` background. Switched to tone color.
- **Dashboard updates list not refreshing after container update** — Backend now clears `updateAvailable` flag after manual trigger; frontend SSE `container-changed` event triggers full data refresh instead of summary-only. ([#229](https://github.com/CodesWhat/drydock/issues/229))
- **Dashboard layout customizations lost on page reload** — Added `gridLayout` to `PreferencesSchema`; reorder now uses `loadPersistedLayout` instead of `createLayoutFromOrder`. ([#223](https://github.com/CodesWhat/drydock/issues/223))
- **Mobile vertical scroll on containers page** — Restored vertical scrolling on the containers page when viewed on mobile devices. ([#231](https://github.com/CodesWhat/drydock/issues/231))
- **Podman pod infra containers skipped** — Watchers now skip Podman pod infrastructure containers that have an empty `Image` field instead of failing during version comparison. ([#182](https://github.com/CodesWhat/drydock/issues/182))
- **Dashboard scroll and layout fixes** — Removed scroll trap from Security Overview widget ([#216](https://github.com/CodesWhat/drydock/issues/216)), prevented dashboard widget scroll layout shift ([#217](https://github.com/CodesWhat/drydock/issues/217)), stopped table resize handles from bleeding through modals, and discarded corrupted single-column grid layouts on load.
- **Stale updateAvailable overwrite after remote trigger** — Agent controller no longer overwrites cleared `updateAvailable` flags with stale snapshot data after a remote trigger completes. ([#229](https://github.com/CodesWhat/drydock/issues/229))
- **MQTT HASS sensor preserved during container recreate** — `removeContainerSensor()` now checks for a same-name replacement via `replacementExpected` flag before publishing the empty retained discovery payload, preventing the HA entity from briefly disappearing during Docker recreate. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **Container actions route by ID instead of display name** — UI grouping, action dispatch, and policy state now keyed by container ID, fixing cross-host collisions where same-named containers on different hosts overwrote each other in the name-keyed map. ([#183](https://github.com/CodesWhat/drydock/issues/183))
- **Digest-pinned update detection** — Digest-only images (`sha256:…`) now run digest watch when `dd.watch.digest=true` instead of dead-ending. Docker trigger uses the remote digest for digest-pinned container updates. ([#192](https://github.com/CodesWhat/drydock/issues/192))
- **Container inspect Config.Image fallback** — When Docker summary only exposes a `sha256:…` image ID (no RepoTags), container discovery falls back to container inspect `Config.Image` to recover the original tagged reference. Stale cached entries self-heal on the next watcher cycle. ([#238](https://github.com/CodesWhat/drydock/issues/238))
- **Updates Available 6-row cap regression** — The `RECENT_UPDATES_LIMIT` slice that was removed for rc.1 was accidentally reintroduced in rc.2. Removed again with regression tests. ([#208](https://github.com/CodesWhat/drydock/issues/208))
- **Host Status widget scroll shift** — Rows changed from `items-center` to `items-start` with pinned badges, fixing asymmetric clipping at scroll edge where badges disappeared before text. ([#217](https://github.com/CodesWhat/drydock/issues/217))
- **Human-readable log timestamps** — Explicit `translateTime: 'SYS:HH:MM:ss.l'` in pino-pretty config for local-time formatted output. ([Discussion #221](https://github.com/CodesWhat/drydock/discussions/221))
- **Dashboard edit-mode mobile scroll** — Widget dragging restricted to `.drag-handle` via `dragAllowFrom`, and widget body keeps `touch-action: pan-y` so vertical swipes scroll during edit mode. ([#222](https://github.com/CodesWhat/drydock/issues/222))
- **Spurious SMTP emails after update** — `clearDetectedUpdateState()` now clears raw `result`/`updateKind` data instead of the derived `updateAvailable` boolean, which was immediately recomputed back to true by model validation. ([#228](https://github.com/CodesWhat/drydock/issues/228), [#229](https://github.com/CodesWhat/drydock/issues/229))
- **Update All button hidden for bouncer-blocked stacks** — Visibility check changed from `updatableCount` to `updatesAvailable` so the button renders as disabled with a lock icon when all containers are security-blocked. ([#237](https://github.com/CodesWhat/drydock/issues/237))
- **Docs site JS hydration blocked by SRI** — Removed `experimental.sri` from Next.js config; the integrity manifest was not generated on Vercel, causing browsers to block dynamically injected scripts. ([Discussion #236](https://github.com/CodesWhat/drydock/discussions/236))
- **Update state lost on navigation/refetch** — Backend list endpoint now enriches containers with in-progress update operation state. UI mapper and action composables consume it to restore "Updating" visual state after refetch or navigation. ([#248](https://github.com/CodesWhat/drydock/issues/248))
- **Unified display-timestamp module** — Extracted shared display-timestamp formatting across all log surfaces; system log viewer was still showing raw ISO timestamps. ([Discussion #221](https://github.com/CodesWhat/drydock/discussions/221))
- **Dashboard scroll dead zones on mobile** — Scroll container extended edge-to-edge via negative margins into `<main>` padding, eliminating gutter dead zones on all sides. Mobile padding tightened for near-flush widget layout. ([#222](https://github.com/CodesWhat/drydock/issues/222))
- **OIDC SSO broken after upgrade/restart** — OIDC discovery made lazy so startup failure no longer drops the provider. Redirect, callback, and token paths retry on first use. ([#246](https://github.com/CodesWhat/drydock/issues/246))
- **Container update fails with 500 error when no healthcheck** — Health gate now skipped when `dd.rollback.auto` is not set. Pre-healthy timeout uses `max(120s, dd.rollback.window)` instead of a fixed value. ([#245](https://github.com/CodesWhat/drydock/issues/245))
- **Same-name container collision in ID/meta maps** — `containerIdMap` and `containerMetaMap` no longer overwrite entries when the same container name exists across multiple hosts. Log refresh uses container ID when name aliases are ambiguous. ([#183](https://github.com/CodesWhat/drydock/issues/183))
- **Digest mode buffer lost on failed flush** — Digest buffer entries are now retained when a batch send fails instead of being cleared. Overlapping flush guard prevents concurrent digest dispatches. ([#249](https://github.com/CodesWhat/drydock/issues/249))
- **Host Status widget scroll snapping** — `snap-y snap-mandatory` plus trailing spacer so the widget always settles on a full row instead of resting on partial rows. ([#217](https://github.com/CodesWhat/drydock/issues/217))
- **Digest watch lost for Docker Hub containers with recovered tags** — Digest watch now stays enabled when Docker summary exposes a `sha256:…` image but container inspect recovers a tagged reference like `:latest`. Prevents update detection from regressing to "suggested tag only" on Docker Hub. ([#192](https://github.com/CodesWhat/drydock/issues/192))
- **Dashboard drag-scroll orphaned loops** — Auto-scroll rAF loop now tracks an explicit active flag, cleared on edit-mode exit and Escape keypress. Prevents orphaned scroll loops when edit mode is toggled rapidly.
- **Pending update settlement status** — `isPendingUpdateSettled` now derives expected status from snapshot or live container (not snapshot-only), fixing cases where the settlement check short-circuited when no snapshot was captured. ([#248](https://github.com/CodesWhat/drydock/issues/248))
- **Dashboard pending update poll backoff** — Polling switches from fixed-interval `setInterval` to chained `setTimeout` with exponential backoff (2s → 16s cap), reducing unnecessary fetches for slow updates.

### Accessibility

- **Tooltip audit** — Added `v-tooltip` to interactive elements and status indicators missing tooltip hints: status dots (watchers, registries, triggers, audit, security), drag handles on dashboard widgets, icon-only badges (registry private/public), NotificationBell button, pagination and test buttons, and spinner/action-in-progress indicators. ([Discussion #199](https://github.com/CodesWhat/drydock/discussions/199))

### Security

- **Log injection prevention** — Removed version string interpolation from startup and migration log messages.
- **Reflected XSS in Podman redirect guard** — 404 handler no longer reflects request URL in response body.
- **TOCTOU race in SRI script** — `apply-sri.mjs` now uses `readdirSync({ withFileTypes })` to eliminate stat/read race condition.
- **WebSocket origin and lockout hardening** — Added stricter WebSocket origin validation and safer lockout file-permission handling.
- **Trivy supply chain advisory** — Published advisory page and site banner for Trivy supply chain compromise. Pinned Trivy versions and corrected advisory details.
- **Security bouncer enforcement on container updates** — Update and Update All actions now enforce the security bouncer gate, surfacing blocked-update reasons in the UI instead of silently failing.
- **Agent log entry sanitization** — Agent log proxy endpoint now uses an allowlist-based normalizer that only forwards known fields (timestamp, level, component, msg, message, displayTimestamp), preventing unexpected or sensitive properties from leaking through.

### Dependencies

- **`fast-xml-parser` upgraded to 5.5.8** — Addresses CVE-2026-33349 (numeric entity expansion bypass). Updated app/e2e dependency versions.
- **Vite 7.3 upgraded to 8.0** — Migrated to Vite 8.0 with Rolldown bundler.
- **Patch/minor dependency bumps** — Updated all patch/minor dependencies and upgraded knip to v6.
- **Vulnerable transitive dependency patches** — nodemailer 8.0.3→8.0.4, picomatch→4.0.4, brace-expansion→5.0.5, smol-toml→1.6.1, yaml→2.8.3.
- **next 16.2.1→16.2.2** — CVE-2025-59472 (GHSA-5f7q-jpqc-wp7h).
- **lodash 4.17.23→4.18.1** — CVE-2026-2950 (GHSA-f23m-r3pf-42rh), CVE-2026-4800 (GHSA-r5fr-rjxr-66jc).

### Testing

- **Coverage and stability expansion** — Added/updated tests for WebSocket log streaming, auth lockout flows, registry provider error paths, webhook payload bounds, release-notes/digest lifecycle, and dashboard layout defaults; refactored large trigger/watcher suites for clearer ownership and lower flake risk.

### Documentation

- **Guide/API endpoint synchronization** — Updated current docs and guides to consistently use canonical `/api/v1/*` paths, expanded container list API docs, and added dashboard customization guide.

## [1.4.5] — 2026-03-17

### Added

- **Dashboard Update buttons** — Per-row update buttons and "Update all" button in the Updates Available dashboard widget. ([#173](https://github.com/CodesWhat/drydock/discussions/173))
- **Getting Started guide** — New step-by-step onboarding guide covering watchers, tag filters, registries, notifications, auto-updates, safety features, and multi-host setup. ([#153](https://github.com/CodesWhat/drydock/discussions/153))

### Fixed

- **Container recreate alias filtering** — Hardened Docker watcher timestamp parsing, added event handler early return for transient aliases, canonical MQTT topic naming, and stale topic cleanup for recreated containers. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **About modal version display** — Version is now fetched dynamically from the API instead of being hardcoded, ensuring the modal always reflects the running server version. ([#167](https://github.com/CodesWhat/drydock/issues/167))
- **Version resolution fallback** — `DD_VERSION=unknown` is now skipped so the version is correctly read from `package.json` at startup.
- **Theme circle transition origin** — The theme toggle circle animation now originates from the click point instead of the viewport center.
- **Trigger code bugs** — Gotify URL and Apprise URL now correctly enforce `.required()` validation; Kafka `clientId` casing normalized with `clientId` kept as a deprecated compatibility alias until v1.6.0.

### Security

- **OIDC debug log redaction** — Sensitive OIDC parameters (`client_id`, `code_challenge`, `state`, etc.) are now redacted in debug logs. ([#168](https://github.com/CodesWhat/drydock/issues/168))
- **Agent API error sanitization** — Error logs and responses in the agent API are sanitized to prevent leaking internal details.
- **Registry config value redaction** — Trigger group configuration now logs keys only, not values, to prevent secret leakage.

### Changed

- **API versioning** — All UI fetch calls migrated from `/api/` to `/api/v1/` paths.
- **OIDC empty bearer token log level** — Downgraded empty bearer token log from `warn` to `debug`. ([#169](https://github.com/CodesWhat/drydock/issues/169))

### Documentation

- **Docs audit (78 files)** — Fixed 18 doc accuracy issues, 3 code bugs, 22+ broken links, and restructured 8 pages (90 callouts → 36). Triggers overview reduced from 17 callouts to 3 with threshold reference table. Template variables expanded from 12 to 30 with example values. Docker Compose trigger now linked from triggers overview. ([#153](https://github.com/CodesWhat/drydock/discussions/153), [#172](https://github.com/CodesWhat/drydock/discussions/172))

### Dependencies

- **Security** — `fast-xml-parser` 5.3.8 → 5.5.6 (CVE: numeric entity expansion bypass), `next` 16.1.6 → 16.1.7 (HTTP smuggling, CSRF bypass, DoS)
- **CI** — `step-security/harden-runner` v2.15.1 → v2.16.0, `github/codeql-action` v4.32.6 → v4.33.0
- **App** — `@aws-sdk/client-ecr`, `@slack/web-api`, `express-rate-limit`, `fast-check`, `knip`, `nodemailer`, `undici`, `@types/node`
- **UI** — `@iconify-json/lucide`, `knip`, `jsdom` 28 → 29
- **Website** — `fumadocs-core`, `fumadocs-mdx`, `fumadocs-ui`, `lucide-react`, `lefthook`, `@vercel/analytics` v1 → v2, `@vercel/speed-insights` v1 → v2
- **Demo** — `@iconify-json/lucide`, `@vitejs/plugin-vue`, `msw` 2.10 → 2.12
- **E2E** — `@dotenvx/dotenvx`, `fast-xml-parser`, `minimatch`

### Chore

- **QA infrastructure** — Added Portainer, slow-shutdown container, and watchevents service for end-to-end container recreate testing. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **Coverage and types cleanup** — Coverage read retry, OpenAPI re-export, and auth types cleanup.
- **Demo version bump** — Bumped demo package version to 1.4.5.
- **Alias filtering test coverage** — Added timestamp edge-case tests for Docker watcher alias filtering. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **msw worker regenerated** — Updated `mockServiceWorker.js` for msw 2.12 (origin-based → clientId-based validation).

## [1.4.4] — 2026-03-16

### Added

- **Click-to-copy on version tags** — CopyableTag component with clipboard feedback on all version displays (dashboard, container list, detail panels). ([#164](https://github.com/CodesWhat/drydock/issues/164))
- **Dark mode icon inversion** — Simple Icons (`si:` prefix) auto-invert in dark mode via Tailwind dark variant.
- **Tailwind v4 class-based dark mode** — `@custom-variant dark` directive for proper `.dark` class detection.

### Changed

- **Dashboard Updates Available version column centered.**
- **Sidebar search button border removed** — `⌘K` badge improved dark mode contrast.
- **URL rebrand** — All URLs updated from `drydock.codeswhat.com` to `getdrydock.com`.

### Fixed

- **Dashboard host-status widget showing 0 for non-agent remote watchers** — Dashboard host-status widget incorrectly showed zero container counts for non-agent remote watchers by using `watcher.id` instead of `watcher.name` as the lookup key. ([#155](https://github.com/CodesWhat/drydock/issues/155))
- **Container recreate alias duplicates** — Unconditional 30s transient window skip, single inspect per event, event path guard prevent Docker's transient `<id-prefix>_<name>` aliases from producing duplicate container entries in triggers. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **Tooltip viewport overflow** — Replaced CSS pseudo-element tooltips with body-appended popup using `position:fixed` and auto-flip. ([#165](https://github.com/CodesWhat/drydock/issues/165))
- **Theme switcher broken** — Restored document binding for `startViewTransition` API.

## [1.4.3] — 2026-03-16

### Fixed

- **DNS resolution failures on Alpine (EAI_AGAIN)** — Node.js 24 defaults to `verbatim` DNS ordering, which on Alpine's musl libc can cause `getaddrinfo EAI_AGAIN` errors when IPv6 records are returned first on dual-stack networks. Drydock now defaults to IPv4-first DNS ordering at startup, configurable via `DD_DNS_MODE` (`ipv4first` | `ipv6first` | `verbatim`, default: `ipv4first`). ([#161](https://github.com/CodesWhat/drydock/issues/161))
- **Multi-platform Docker build validation** — CI now validates multi-platform Docker builds to catch architecture-specific failures early.

### Security

- **Zizmor findings blocking in CI and lefthook** — GitHub Actions security findings from zizmor are now blocking in both CI and local pre-push hooks.
- **Secrets scoped to dedicated GitHub environments** — CI secrets are now scoped to dedicated GitHub environments instead of repository-level access.

### Documentation

- **Docker socket security guide** — Expanded watcher docs with comprehensive security section: comparison table of all access methods, socket proxy setup (recommended), remote Docker over TLS with cert generation walkthrough, rootless Docker guide, full Docker API endpoint reference showing exactly which endpoints Drydock uses for read-only monitoring vs write operations (updates).

### Dependencies

- **CI actions** — Bumped upload-artifact to v7 and replaced nick-fields/retry.

## [1.4.2] — 2026-03-15

### Added

- **Update-operations pagination** — `GET /api/containers/:id/update-operations` now supports `limit` and `offset` query parameters with `_links` navigation, matching the existing container list pagination pattern.
- **Periodic audit log pruning** — Audit store now runs a background timer (hourly, unref'd) to prune stale entries even with low insert volume, in addition to the existing insert-count-based pruning.
- **Container release notes enrichment** — Watch cycles now enrich update candidates with GitHub release metadata (`result.releaseNotes` and `result.releaseLink`), and full notes are available via `GET /api/containers/:id/release-notes`.
- **Container list sort and filter query params** — `GET /api/containers` now supports `sort` (`name`, `status`, `age`, `created`, with optional `-` prefix for descending), plus `status`, `kind`, `watcher`, and `maturity` filters.
- **Update age and maturity API signals** — Container payloads now track `updateAge` and support maturity states (`hot`, `mature`, `established`) for filtering and policy workflows.
- **Suggested semver tag hints** — Containers tracked on non-semver tags such as `latest` now expose `result.suggestedTag` to surface the best semver target.
- **`oninclude` trigger auto mode** — Trigger `auto` now supports `oninclude`, which only auto-runs for containers explicitly matched by include labels. ([#160](https://github.com/CodesWhat/drydock/issues/160))
- **Container runtime observability APIs** — Added `/api/containers/stats`, `/api/containers/:id/stats`, and `/api/containers/:id/stats/stream` for resource telemetry, plus richer per-container runtime snapshots.
- **Real-time container log streaming** — Added WebSocket streaming at `/api/v1/containers/:id/logs/stream` with `stdout`/`stderr`, `tail`, `since`, and `follow` controls.
- **Container logs and runtime stats panels** — Container detail views now include dedicated live Logs and Runtime Stats tabs (including full-page logs route support).
- **Signed registry webhook receiver** — Added `POST /api/webhooks/registry` with HMAC signature verification and provider-specific payload parsing for registry push events.
- **Auth lockout Prometheus observability** — Added Prometheus metrics for login success/failure and lockout activity.

### Changed

- **Extract maturity-policy module** — Consolidated scattered day-to-millisecond conversions and maturity policy constants into `app/model/maturity-policy.ts`, shared by backend, UI, and demo app.
- **Extract security-overview module** — Moved security vulnerability aggregation and pagination logic from `crud.ts` into dedicated `app/api/container/security-overview.ts` for improved readability and testability.
- **Refactor Docker Compose trigger** — Extracted YAML parsing/editing into `ComposeFileParser` and post-start hook execution into `PostStartExecutor`, reducing the monolithic `Dockercompose.ts` by ~400 lines.
- **Decompose useContainerActions** — Split the 1200-line composable into focused modules: `useContainerBackups`, `useContainerPolicy`, `useContainerPreview`, and `useContainerTriggers`.
- **Registry error handling** — Replaced `catch (e: any)` with `catch (e: unknown)` and `getErrorMessage(e)` in component registration and trigger/watcher startup.
- **E2E test resilience** — Container row count assertions now use `toBeGreaterThan(0)` instead of hardcoded counts, preventing false failures when the QA environment has a different number of containers.
- **Registry digest cache dedup per poll cycle** — Digest cache lookups now deduplicate repeated requests within a single poll cycle, reducing redundant registry calls and improving metric accuracy.
- **Extract runtime config evaluation context type** — Consolidated scattered runtime field evaluation parameters into a typed `ClonedRuntimeFieldEvaluationContext` interface for trigger providers.
- **Argon2 hash parsing type safety** — Extracted `Argon2Parameters` interface, parameter key type guard, and PHC parameter parsing into a reusable function for improved type safety.
- **Extract agent client initialization methods** — Extracted URL parsing, HTTPS detection, protocol validation, and TLS configuration from monolithic constructor into focused private methods.
- **Extract shared self-hosted registry config schema** — Deduplicated the registry configuration schema (url, login, password, auth, cafile, insecure, clientcert, clientkey) into a reusable helper shared by Custom and SelfHostedBasic registry providers.

### Documentation

- **Podman docs expansion** — Added Podman setup/compatibility guidance plus SELinux, `podman-compose`, and production notes in watcher and FAQ docs.
- **Docs site URL rebrand** — Replaced `drydock.codeswhat.com` links with `getdrydock.com` across docs pages, sitemap/robots metadata, and website copy.

### Fixed

- **CSRF validation behind reverse proxies** — Same-origin mutation checks now honor `X-Forwarded-Proto` and `X-Forwarded-Host` when present before falling back to direct request protocol/host, preventing false `403 CSRF validation failed` responses in TLS-terminating proxy setups. ([#146](https://github.com/CodesWhat/drydock/issues/146))
- **Hosts page missing env-var-configured watchers** — The Hosts page hardcoded a single "Local" entry and only added agent-based hosts. Watchers configured via `DD_WATCHER_*` environment variables (e.g. remote Docker hosts) were never displayed, even though their containers appeared correctly on the Containers page. The page now fetches all watchers from the API and displays each local watcher with its actual name and connection address. ([#151](https://github.com/CodesWhat/drydock/issues/151))
- **Docker events reconnect with malformed errors** — Reconnect failure logging no longer crashes when the error object has no `message` property.
- **Security overview container count** — The security vulnerability overview now uses the lightweight store count instead of loading all container objects just to count them.
- **Compose path deduplication** — Replaced `indexOf`-based dedup with `Set` for compose file path detection in container security view.
- **Build provenance attestation** — CI attestation step now runs with `if: always()` so provenance is attested even when prior optional steps are skipped.
- **Container recreate alias duplicates in triggers** — When containers were recreated externally (via Portainer or `docker compose up`), Docker's transient `<id-prefix>_<name>` aliases were treated as new containers, producing duplicate entries in MQTT Home Assistant discovery sensors and Telegram notifications. Added alias deduplication filtering and force-removal of stale container IDs on recreate detection. ([#156](https://github.com/CodesWhat/drydock/issues/156))
- **Stale store data after external container recreation** — Watch-at-start scan was suppressed when the store already had container data, leaving stale records from the previous run after external container recreation. Removed the suppression so every startup runs a full scan with alias filtering. ([#157](https://github.com/CodesWhat/drydock/issues/157))
- **Watcher container counts on Hosts page** — Per-watcher container counts on the Hosts page used `watcher.id` (e.g. `docker.esk83`) as the lookup key instead of `watcher.name` (e.g. `esk83`), causing counts to display as zero for env-var-configured watchers. ([#155](https://github.com/CodesWhat/drydock/issues/155))
- **Docker images tagged `:main` with no version** — CI release workflow triggered on both main branch pushes and version tags, producing Docker images tagged `:main` that showed `DD_VERSION=main` instead of a real version number. Release workflow now only triggers on version tags (`v*`). ([#154](https://github.com/CodesWhat/drydock/issues/154))
- **Maturity badge sizing and tooltip clipping** — Fixed maturity badge height mismatch with other text badges and removed `overflow-hidden` from DataListAccordion that clipped tooltips in list view.

### Security

- **Agent secret over plaintext HTTP warning** — Agent clients now log a warning when a shared secret is configured over unencrypted HTTP, advising HTTPS configuration.
- **Auth audit log injection** — Login identity values are now sanitized with `sanitizeLogParam()` before inclusion in audit log details, preventing log injection via crafted usernames.
- **SSE self-update ack hardening** — Added validation for empty `clientId`/`clientToken`, non-ack broadcast mode, and client-not-bound-to-operation rejection.
- **FAQ: removed insecure seccomp advice** — Removed the "Core dumped on Raspberry PI" FAQ entry that recommended `--security-opt seccomp=unconfined`, which completely disables the kernel's syscall sandbox. The underlying libseccomp2 bug was fixed in all supported OS versions since 2021.

### Dependencies

- **biome** — Bumped to 2.4.7 with import ordering fixes for new lint rules.
- **vitest** — Bumped to 4.1.0 in app workspace with fast-check/vitest 0.3.0 and knip 5.86.0.
- **UI packages** — Bumped vue, vitest, storybook, and icon packages.
- **CI actions** — Bumped zizmor-action to v0.5.2 and cosign-installer to v4.1.0.

## [1.4.1] — 2026-03-14

### Added

- **Headless mode (`DD_SERVER_UI_ENABLED`)** — Run drydock as an API-only service by setting `DD_SERVER_UI_ENABLED=false`. The REST API, SSE, and healthcheck endpoints remain fully functional while the UI is not served. Useful for controller nodes that only manage agents.
- **Maturity-based update policy** — Per-container update maturity policy configurable from the container row's **Update policy** menu (or `PATCH /api/v1/containers/:id/update-policy`). Modes: `all` (default — allow any update) and `mature` (block updates detected less than `maturityMinAgeDays` ago, default 7). UI shows NEW/MATURE badges with flame/clock icons on containers with available updates. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **`?groupByStack=true` URL parameter** — Bookmarkable URL parameter to enable stack grouping on the containers page. Also accepts `?groupByStack=1`. ([#145](https://github.com/CodesWhat/drydock/issues/145))

### Changed

- **Connection-lost overlay animation** — The connection-lost and reconnecting overlays now use a bounce animation for improved visual feedback.
- **Watch target resolution refactored to discriminated union** — Internal refactor of the watch target resolution logic for improved type safety and maintainability.

### Fixed

- **Agent handshake and SSE validation failure** — Fixed agent API returning redacted container data (with `sensitive` field on env entries) instead of raw data, causing controller-side Joi validation to reject the handshake and crash on real-time SSE container events. SSE payloads now prefer canonical raw store data with sanitization fallback. ([#141](https://github.com/CodesWhat/drydock/issues/141))
- **Mangled argon2 hash detection** — Docker Compose `$` interpolation can strip `$` delimiters from argon2 PHC hashes, producing an invalid hash that silently failed registration. Drydock now detects mangled hashes at startup and surfaces an actionable error message. ([#147](https://github.com/CodesWhat/drydock/issues/147))
- **Anonymous auth fallback** — When all configured auth providers fail to register (e.g. due to a mangled hash), Drydock now falls back to anonymous mode if `DD_ANONYMOUS_AUTH_CONFIRM=true` is set, instead of leaving the user with no way to log in. ([#147](https://github.com/CodesWhat/drydock/issues/147))
- **Auth registration errors on login page** — Registration warnings (e.g. invalid hash format) are now surfaced on the login page so users can see exactly what went wrong instead of a generic "No authentication methods configured" message. ([#147](https://github.com/CodesWhat/drydock/issues/147))
- **CSP inline style violations** — Replaced runtime `element.style` mutations (DataTable column resize, tooltip directive, theme transitions, preference restore) with CSS custom properties and class-based styling. Relaxed `style-src` to include `'unsafe-inline'` for vendor libraries (iconify-icon, Vue Transition) that set `element.style` programmatically.
- **Compose trigger affinity across remapped roots** — Compose trigger file-path matching now uses suffix-based comparison as a fallback when the container's compose label path (host mount) differs from the trigger's configured path (container-internal), preventing missed trigger associations in bind-mount setups.
- **Compose trigger association** — Enforce compose-file affinity when associating triggers with containers, preventing incorrect trigger-container matching. ([#139](https://github.com/CodesWhat/drydock/issues/139))
- **Update All button icon centering** — Fixed icon-text alignment in the Update All group header button to match the split button pattern used elsewhere.
- **Selected card border clipping** — Fixed card border clipping on the first grid column in card view.

### Security

- **Username enumeration timing side-channel** — Eliminated timing difference between valid and invalid usernames during authentication.
- **LokiJS metadata exposure** — Stripped internal LokiJS fields (`$loki`, `meta`) from settings API responses, agent API container responses, and `/app` endpoint.
- **Permissions-Policy header** — Added `Permissions-Policy` header to restrict browser feature access (camera, microphone, geolocation, etc.).
- **CSP and Cross-Origin-Embedder-Policy** — Tightened Content Security Policy and added COEP header.
- **Production image hardening** — Removed `wget`, `nc`, and `npm` from the production Docker image; upgraded zlib.

### Dependencies

- **undici** — Bumped to 7.24.1 (fixes 12 CVEs including WebSocket memory consumption, CRLF injection, and request smuggling).

## [1.4.0] — 2026-02-28

### Breaking Changes

- **MQTT `HASS_ATTRIBUTES` default changed from `full` to `short`** — This changes Home Assistant entity payloads by default, excluding large SBOM documents, scan vulnerabilities, details, and labels. To retain the previous payload behavior, set `DD_TRIGGER_MQTT_{name}_HASS_ATTRIBUTES=full` explicitly.

### Added

- **Audit log for container state changes** — External container lifecycle events (start, stop, restart via Portainer or CLI) now generate `container-update` audit entries with the new status, so the audit log reflects all state changes, not just Drydock-initiated actions. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **mTLS client certificate support** — Registry providers now accept `CLIENTCERT` and `CLIENTKEY` options for mutual TLS authentication with private registries that require client certificates.

#### Backend / Core

- **Container recent-status API** — `GET /api/containers/recent-status` returns pre-computed update status (`updated`/`pending`/`failed`) per container, replacing the client-side audit log scan and reducing dashboard fetch payload size.
- **Dual-slot security scanning** — "Scan Now" automatically scans both the current running image and the available update image when an update exists. Results are stored in separate slots (`scan`/`updateScan`) and the Security page shows a delta comparison badge (+N fixed, -N new) next to each image that has both scans.
- **`DD_LOG_BUFFER_ENABLED` toggle** — Disable the in-memory log ring buffer via `DD_LOG_BUFFER_ENABLED=false` to reduce per-log processing overhead. When disabled, `/api/log/entries` returns an empty array. Defaults to `true`.
- **Scheduled security scanning** — Set `DD_SECURITY_SCAN_CRON` to automatically scan all watched containers on a cron schedule. `DD_SECURITY_SCAN_JITTER` (default 60s) spreads load with random delay before each cycle.
- **Security scheduler shutdown on exit** — Security scan scheduler is now explicitly shut down during graceful exit, preventing orphan timers from delaying process termination.
- **On-demand sensitive env value reveal** — Container environment variables are redacted by default in API responses. Individual values can be revealed on-demand via `/api/containers/:id/env/reveal` with audit logging.
- **On-demand scans populate digest cache** — Manual container scans now populate the digest-based dedup cache, preventing redundant rescans of the same image digest.
- **Per-container webhook opt-out** — New `dd.webhook.enabled=false` container label to exclude individual containers from webhook triggers without disabling the webhook API globally.
- **Scan cancellation and mobile scan progress** — Security batch scans can now be cancelled mid-flight. Mobile scan progress UI improved with responsive layout.
- **Security scan coverage counts** — Security view header shows scanned/total container counts for at-a-glance scan coverage.
- **Notification rule management API and persistence** — `/api/notifications` CRUD endpoints backed by LokiJS-persisted notification rules for `update-available`, `update-applied`, `update-failed`, `security-alert`, and `agent-disconnect` event types.
- **Rule-aware runtime dispatch** — Trigger event dispatch resolves notification rules at runtime so per-event enable/disable and trigger assignments actively control which triggers fire.
- **Security-alert and agent-disconnect events** — New event types with audit logging and configurable deduplication windows. Security alerts fire automatically on critical/high vulnerability scan results.
- **Compose-native container updates** — Compose-managed containers now update via `docker compose up -d` lifecycle instead of Docker API recreate, preserving compose ownership and YAML formatting.
- **Rename-first rollback with health gates** — Non-self container updates use a rename-first strategy (rename old → create new → health-gate → remove old) with crash-recoverable state persisted in a new `update-operation` store collection. Rollback telemetry via `dd_trigger_rollback_total{type,name,outcome,reason}` counter.
- **Tag-family aware semver selection** — Docker watcher infers the current tag family (prefix/suffix/segment style) and keeps semver updates within that family by default, preventing cross-family downgrades like `5.1.4` → `20.04.1`. Added `dd.tag.family` label (`strict` default, `loose` opt-out) and imgset support. ([#104](https://github.com/CodesWhat/drydock/issues/104))
- **Entrypoint/cmd drift detection** — Docker trigger detects whether entrypoint/cmd were inherited from the source image vs user-set, replacing inherited values with target image defaults during update. Adds `dd.runtime.entrypoint.origin` and `dd.runtime.cmd.origin` labels.
- **Self-update controller with SSE ack flow** — Dedicated controller container for self-update replaces the shell helper pattern. UI acknowledgment via SSE with operation ID tracking.
- **Server-issued SSE client identity** — Replaced client-generated UUIDs with server-issued `clientId`/`clientToken` pairs for self-update ack validation, preventing spoofed acknowledgments.
- **`config migrate` CLI** — `node dist/index.js config migrate` converts legacy `WUD_*` and Watchtower env vars/labels to `DD_*`/`dd.*` format across `.env` and compose files. Supports `--dry-run` preview and `--source` / `--file` selection.
- **Legacy compatibility usage metric** — Prometheus counter `dd_legacy_input_total{source,key}` tracks local runtime consumption of legacy inputs (`WUD_*` env vars, `wud.*` labels) without external telemetry. Startup warns when legacy env vars are detected; watcher/trigger paths emit one-time deprecation warnings on `wud.*` label fallback.
- **Bundled selfhst icons for offline startup** — Common container icons (Docker, Grafana, Nextcloud, etc.) bundled in the image so the UI works without internet on first boot.
- **Runtime tool status endpoint** — `/api/server/security/runtime` reports Trivy/Cosign availability for the Security view.
- **Gzip response compression** — Configurable via `DD_SERVER_COMPRESSION_ENABLED` and `DD_SERVER_COMPRESSION_THRESHOLD` (default 1024 bytes), with automatic SSE exclusion.
- **Container runtime details** — Ports, volumes, and environment exposed in the container model and API for the detail panel.
- **Update detected timestamp** — `updateDetectedAt` field tracks when an update was first seen, preserved across refresh cycles.
- **No-update reason tracking** — `result.noUpdateReason` field surfaces why tag-family or semver filtering suppressed an available update.
- **Remove individual skip entries** — `remove-skip` policy action allows removing a single skipped tag or digest without clearing all skips.
- **Update-operation history API** — `GET /api/containers/:id/update-operations` returns persisted update/rollback history for a container.
- **Settings backend** — `/api/settings` endpoints with LokiJS collection for persistent UI preferences (internetless mode). Icon proxy cache with atomic file writes and manual cache clear.
- **SSE real-time updates** — Server-Sent Events push container state changes to the UI without polling.
- **Remember-me authentication** — Persistent login sessions via remember-me checkbox on the login form.
- **Docker Compose trigger** — Refresh compose services via Docker Compose CLI when updates are detected.
- **Advisory-only security scanning** — `DD_SECURITY_BLOCK_SEVERITY=NONE` runs vulnerability scans without blocking updates. Scan results remain visible in the Security view and audit log.
- **OpenAPI 3.1.0 specification and endpoint** — Machine-readable API documentation available at `GET /api/openapi.json`, covering all v1.4 endpoints with request/response schemas.
- **Watcher agent support initialization** — Watchers now initialize agent support on startup for distributed monitoring readiness.
- **Security vulnerability overview endpoint** — New `GET /api/containers/security/vulnerabilities` returns pre-aggregated vulnerability data grouped by image with severity summaries, so the Security view no longer needs to load all containers.
- **MQTT attribute filtering for Home Assistant** — MQTT trigger supports attribute-based filtering for Home Assistant integration, allowing selective publishing based on container attributes.
- **Docker Compose post_start env validation** — Docker Compose trigger validates environment variables in `post_start` hooks before execution, preventing runtime errors from missing or invalid env var references.
- **MQTT HASS entity_picture from container icons** — When Home Assistant HASS discovery is enabled, `entity_picture` is now automatically resolved from the container's `dd.display.icon` label. Icons with `sh:`, `hl:`, or `si:` prefixes map to jsDelivr CDN URLs for selfhst, homarr-labs, and simple-icons respectively. Direct HTTP/HTTPS URLs pass through unchanged. ([#138](https://github.com/CodesWhat/drydock/issues/138))
- **`dd.display.picture` container label** — New label to override the MQTT HASS `entity_picture` URL directly. Takes precedence over icon-derived pictures when set to an HTTP/HTTPS URL.

#### UI / Dashboard

- **Tailwind CSS 4 UI stack** — Complete frontend migration from Vuetify 3 to Tailwind CSS 4 with custom shared components. All 13 views rebuilt with Composition API.
- **Shared data components** — Reusable DataTable, DataCardGrid, DataListAccordion, DataFilterBar, DetailPanel, DataViewLayout, and EmptyState components used consistently across all views with table/cards/list view modes.
- **6 color themes** — One Dark (clean/balanced), GitHub (clean/familiar), Dracula (bold purple), Catppuccin (warm pastels), Gruvbox (retro earthy warmth), and Ayu (soft golden tones). Each with dark and light variants. Circle-reveal transition animation between themes.
- **7 icon libraries** — Phosphor Duotone (default), Phosphor, Lucide, Tabler, Heroicons, Iconoir, and Font Awesome. Switchable in Config > Appearance with icon size slider.
- **6 font families** — IBM Plex Mono (default/bundled), JetBrains Mono, Source Code Pro, Inconsolata, Commit Mono, and Comic Mono. Lazy-loaded from local `/fonts/` directory with internetless fallback.
- **Command palette** — Global Cmd/Ctrl+K search with scope filtering (`/` pages, `@` runtime, `#` config), keyboard navigation, grouped sections, and recent history.
- **Notification rules management view** — View, toggle, and assign triggers to notification rules with direct save through `/api/notifications`.
- **Audit history view** — Paginated audit log with filtering by container, event text, and action type. Includes security-alert and agent-disconnect event type icons.
- **Container grouping by stack** — Collapsible sections grouping containers by compose stack with count and update badges.
- **Container actions tab** — Detail panel tab with update preview, trigger list, backup/rollback management, and update policy controls (skip tags, skip digests, snooze).
- **Container delete action** — Remove a container from tracking via table row or detail panel.
- **Container ghost state during updates** — When a container is updated, stopped, or restarted, its position is held in the UI with a spinner overlay while polling for the recreated container, preventing the "disappearing container" UX issue. ([#80](https://github.com/CodesWhat/drydock/issues/80))
- **Skip update action** — Containers with pending updates can be individually skipped, hiding the update badge for the current session without requiring a backend endpoint.
- **Slide-in detail panels on all views** — Row-click detail panels for Watchers, Auth, Triggers, Registries, Agents, and Security views.
- **Interactive column resizing** — Drag-to-resize column handles on all DataTable instances.
- **Dashboard live data and drag-reorder** — Stat cards (containers, updates, security, registries) computed from real container data with drag-reorderable layout and localStorage persistence. Security donut chart, host status, and update breakdown widgets.
- **Log viewer auto-fetch and scroll lock** — Configurable auto-fetch intervals (2s/5s/10s/30s) with scroll lock detection and resume for both ConfigView logs and container logs.
- **Keyboard shortcuts** — Enter/Escape for confirm dialogs, Escape to close detail panels.
- **SSE connectivity overlay** — Connection-lost overlay with self-update awareness and auto-recovery.
- **Login page connectivity monitor** — Polls server availability and shows connection status on the login screen.
- **Server name badge for remote watchers** — Shows the watcher name instead of "Local" for multi-host setups.
- **Dynamic dashboard stat colors** — Color-coded update and security stats based on severity ratio.
- **About Drydock modal** — Version info and links accessible from sidebar.
- **View wiring** — Watcher container counts, trigger Test buttons with success/failure feedback, host images count, and registry self-hosted port matching all wired to live API data.
- **Font size preference** — Adjustable font size slider in Config > Appearance for UI-wide text scaling.
- **Announcement banner** — Dismissible banner component for surfacing release notes and important notices in the dashboard.
- **Dashboard vulnerability sort by severity** — Top-5 vulnerability list on the dashboard now sorted by total count descending with critical count as tiebreaker, so the most severe containers appear first.
- **Rollback confirmation dialog** — Container rollback actions now require explicit confirmation through a danger-severity dialog before restoring from backup.
- **Update confirmation dialog** — Container update actions now require explicit confirmation through a dialog before triggering an update.
- **SHA-1 hash deprecation banner** — Dashboard shows a dismissible deprecation banner when legacy SHA-1 password hashes are detected, prompting migration to argon2id.
- **Config tab URL deep-linking** — Config view tab selection syncs to the URL query parameter, enabling shareable direct links to specific config tabs.

### Changed

- **Compose trigger uses Docker Engine API** — Compose-managed container updates now use the Docker Engine API directly (pull, stop, recreate) instead of shelling out to `docker compose` / `docker-compose` CLI. Eliminates `spawn docker ENOENT` errors in environments without Docker CLI binaries installed.
- **Compose self-update delegates to parent orchestrator** — Self-update for compose-managed Drydock containers now uses the parent Docker trigger's helper-container transition with health gates and rollback, instead of direct stop/recreate.
- **Compose runtime refresh extracted** — Shared `refreshComposeServiceWithDockerApi()` helper eliminates the recursive `recreateContainer` → `updateContainerWithCompose` call chain. Both code paths now converge on the same explicit, non-recursive method.
- **Compose-file-once batch mode re-enabled** — `COMPOSEFILEONCE=true` now works with the Docker Engine API runtime. First container per service gets a full runtime refresh; subsequent containers sharing the same service skip the refresh.
- **Self-update controller testable entrypoint** — Extracted process-level entry logic to a separate entrypoint module, making the controller independently testable without triggering process-exit side effects.
- **Dockercompose YAML patching simplified** — Removed redundant type guards and dead-code branches from compose file patching helpers, reducing code paths and improving maintainability.
- **Dashboard fetches recent-status from backend** — Dashboard now fetches pre-computed container statuses from `/api/containers/recent-status` instead of scanning the raw audit log client-side.
- **Prometheus collect() callback pattern** — Switched container gauge from interval-based polling to the Prometheus `collect()` callback, letting Prometheus control collection timing and eliminating the background 5s timer.
- **Container security API refactored** — Container security routes refactored into a dedicated module with type-safe SecurityGate integration, concurrent scan limiting (max 1), and trivy DB status-based cache invalidation.
- **DashboardView composable extraction** — Extracted 700+ line monolith into `useDashboardData`, `useDashboardComputed`, `useDashboardWidgetOrder`, and shared `dashboardTypes` for better testability and separation of concerns.
- **Event-driven connectivity polling** — AppLayout SSE connectivity monitoring now starts on disconnect and stops on reconnect instead of running a fixed interval, reducing unnecessary network requests.
- **Vulnerability loading optimized** — Vulnerability data loaded from the container list API payload (`includeVulnerabilities` flag) instead of separate per-container fetches, reducing API calls on the Security view.
- **Default log format is JSON** — Official Docker image now defaults to `DD_LOG_FORMAT=json` for structured production logs. Override with `DD_LOG_FORMAT=text` for pretty logs.
- **Scan endpoint rate limit reduced** — `POST /api/containers/:id/scan` rate limit lowered from 100 to 30 requests/min to prevent resource exhaustion during aggressive scanning.
- **Single Docker image** — Removed thin/heavy image variants; all images now bundle Trivy and Cosign.
- **Removed Vuetify dependency** — All Vuetify imports, components, and archived test files removed. Zero Vuetify references remain.
- **Fail-closed auth enforcement** — Registry bearer-token flows error on token endpoint failures instead of falling through to anonymous. HTTP trigger auth errors on unsupported types. Docker entrypoint requires explicit `DD_RUN_AS_ROOT` + `DD_ALLOW_INSECURE_ROOT` for root mode.
- **Fail-closed anonymous auth on fresh installs** — New installs with no authentication configured and no `DD_ANONYMOUS_AUTH_CONFIRM=true` fail closed at startup (all API calls return 401). Users upgrading from a previous version are allowed anonymous access with a startup warning. Set `DD_AUTH_BASIC_<name>_USER` / `DD_AUTH_BASIC_<name>_HASH` to configure authentication, or set `DD_ANONYMOUS_AUTH_CONFIRM=true` to explicitly allow anonymous access.
- **Dashboard streamlined** — Stat cards reduced from 7 to 4 (Containers, Updates, Security, Registries). Recent Activity widget removed to fit on single viewport. Background refresh prevents loading flicker on SSE events.
- **Notifications view is full rule management** — Editable notification rules (enable/disable and trigger assignments) that save directly through `/api/notifications`.
- **Standardized API responses with collection pattern** — All collection endpoints (`/api/containers`, `/api/registries`, `/api/watchers`, `/api/authentications`, `/api/audit`) now return `{ data: [...], total }` instead of raw arrays. Supports pagination via `offset`/`limit` query parameters.
- **Paginated API discoverability links** — Paginated collection responses now include `_links.self` and `_links.next` where applicable (for example `/api/containers` and `/api/audit`) to make page traversal explicit for API consumers.
- **Versioned API base path with transition alias** — `/api/v1/*` is now the canonical API path for integrations. `/api/*` remains as a backward-compatible alias during migration and is planned for removal in a future major release (target: v2.0.0).
- **Agent-scoped path order normalized** — Agent-qualified component and trigger routes now use `/:type/:name/:agent` (for example `/api/triggers/:type/:name/:agent` and `/api/containers/:id/triggers/:triggerType/:triggerName/:triggerAgent`) instead of the old agent-first order. This is a breaking change for external API clients using the old path shape.
- **Machine-readable API error contract** — All error responses return a consistent `{ "error": "..." }` JSON structure with an optional `details` object for contextual metadata.
- **6 color themes** — Replaced original Drydock theme with popular editor palettes: One Dark, GitHub, Dracula, Catppuccin, Gruvbox, and Ayu. Each with dark and light variants.
- **Argon2id password hashing** — Basic auth now uses argon2id (OWASP recommended) via Node.js built-in `crypto.argon2Sync()` instead of scrypt for password hashing. Default parameters: 64 MiB memory, 3 passes, parallelism 4.
- **PUT `/api/settings` deprecated** — `PUT /api/settings` now returns RFC 9745 `Deprecation` and RFC 8594 `Sunset` headers. Use `PATCH /api/settings` for partial updates. PUT alias removal targeted for v1.5.0.
- **Basic auth argon2id PHC compatibility** — Basic authentication now accepts PHC-format argon2id hashes (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`) in addition to the existing Drydock `argon2id$memory$passes$parallelism$salt$hash` format. Hash-generation guidance now recommends the standard `argon2` CLI command first, with Node.js as a secondary option.
- **Borderless UI redesign** — Removed borders from all views, config tabs, detail panels, and shared data components for a cleaner visual appearance.
- **Dashboard version column alignment** — Version column in the dashboard updates table is now left-aligned for better readability.
- **Detail panel expand button redesigned** — Full-page expand button in the detail panel now uses a frame-corners icon instead of the previous maximize icon.
- **Sidebar active indicator removed** — Removed the blue active indicator bar from sidebar navigation items for a cleaner look.

### Fixed

- **Log level setting had no effect** — `DD_LOG_LEVEL=debug` was correctly parsed but debug messages were silently dropped because pino's multistream destinations defaulted to `info` level. Stream destinations now inherit the configured log level. ([#134](https://github.com/CodesWhat/drydock/issues/134))
- **Server feature flags not loaded after login** — Feature flags (`containeractions`, `delete`) were permanently stuck as disabled when authentication was required, because the pre-login bootstrap fetch failure marked the flags as "loaded" and never retried. Now failed fetches allow automatic retry after login. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **Compose trigger silently skips containers** — Multiple failure paths in the compose trigger were logged at `debug` level, making it nearly impossible to diagnose why a trigger reports success but containers don't update. Key diagnostic messages (compose file mismatch, label inspect failure, no containers matched) promoted to `warn` level, and the "already up to date" message now includes container names. ([#84](https://github.com/CodesWhat/drydock/discussions/84))
- **Fallback icon cached permanently** — The Docker placeholder icon was served with `immutable` cache headers, causing browsers to cache it permanently even after the real provider icon becomes available. Fallback responses now use `no-store`.
- **Basic auth upgrade compatibility restored** — Basic auth now accepts legacy v1.3.9 Basic auth hashes (`{SHA}`, `$apr1$`/`$1$`, `crypt`, and plain fallback) to preserve smooth upgrades. Legacy formats remain deprecated and continue showing a migration banner, with removal still planned for v1.6.0.
- **Compose trigger rejects lowercase env var keys** — Configuration keys like `COMPOSEFILEONCE`, `DIGESTPINNING`, and `RECONCILIATIONMODE` were lowercased by the env parser but the Joi schema expected camelCase. Schema now maps lowercase keys to their camelCase equivalents. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **Compose trigger strips docker.io prefix** — When a compose file uses an explicit `docker.io/` registry prefix, compose mutations now preserve it instead of stripping it to a bare library path. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **Compose trigger fails when FILE points to directory** — `DD_TRIGGER_DOCKERCOMPOSE_{name}_FILE` now accepts directories, automatically probing for `compose.yaml`, `compose.yml`, `docker-compose.yaml`, or `docker-compose.yml` inside the directory. ([#84](https://github.com/CodesWhat/drydock/discussions/84))
- **Container healthcheck fails with TLS backend** — The Dockerfile healthcheck now detects `DD_SERVER_TLS_ENABLED=true` and switches to `curl --insecure https://` for self-signed certificates. Also skips the healthcheck entirely when `DD_SERVER_ENABLED=false`. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **Agent CAFILE ignored without CERTFILE** — The agent subsystem now loads the CA certificate from `CAFILE` even when `CERTFILE` is not provided, fixing TLS verification for agents behind reverse proxies with custom CA chains.
- **Service worker accepts cross-origin postMessage** — The demo service worker now validates `postMessage` origins against the current host, preventing potential cross-origin message injection.

- **Action buttons disable and show spinner during in-progress actions** — Container action buttons (Stop, Start, Restart, Update, Delete) now show a disabled state with a spinner while the action runs in the background, providing clear visual feedback. The confirm dialog closes immediately on accept instead of blocking the UI.
- **Command palette clears stale filter on navigation** — Navigating to a container via Ctrl+K search now clears the active `filterKind`, preventing stale filter state from hiding the navigated container.
- **Manual update button works with compose triggers** — The update container endpoint now searches for both `docker` and `dockercompose` trigger types, matching the existing preview endpoint behavior. Previously, users with only a compose trigger saw "No docker trigger found for this container".
- **CI: qlty retry on timeout** — Changed `retry_on` from `error` to `any` so qlty timeouts trigger retries. Increased timeout from 5 to 8 minutes.
- **OIDC docs clarified `DD_PUBLIC_URL` requirement** — OIDC documentation now explicitly marks `DD_PUBLIC_URL` as required and includes it in all provider example configurations (Authelia, Auth0, Authentik, Dex). Without this variable, the OIDC provider fails to register at startup.
- **Compose trigger docs updated for Engine API** — Removed stale references to `docker compose config --quiet` CLI validation and `docker compose pull`/`up` commands. Docs now reflect in-process YAML validation and Docker Engine API runtime. Added callout that Docker Compose CLI is not required.
- **Container actions docs updated for compose triggers** — Update action documentation now mentions both Docker and Docker Compose trigger support.
- **Compose trigger rejects compose files mounted outside app directory** — Removed overly strict working-directory boundary enforcement from `runComposeCommand` that rejected compose files bind-mounted outside `/home/node/app`, breaking documented mount patterns like `/drydock/docker-compose.yml`. Compose file paths are operator-configured and already validated during resolution.
- **Compose trigger uses host paths instead of container paths** — Docker label auto-detection (`com.docker.compose.project.config_files`) now remaps host-side paths to container-internal paths using Drydock's own bind mount information. Previously, host paths like `/mnt/volume1/docker/stacks/monitoring/compose.yaml` were used directly inside the container where they don't exist, causing "does not exist" errors even when the file was properly mounted.
- **Compose trigger logs spurious warnings for unrelated containers** — When multiple compose triggers are configured, each trigger now silently skips containers whose resolved compose files don't match the trigger's configured `FILE` path, eliminating noisy cross-stack "does not exist" warnings.
- **Silent error on recheck failure** — "Recheck for Updates" button now displays an error banner when the backend request fails instead of silently stopping the spinner with no feedback.
- **Silent error on env reveal failure** — Environment variable reveal in the container detail panel now shows an inline error message when the API call fails instead of silently failing.
- **Security scans persist across navigation** — Navigating away from the Security view no longer cancels in-flight batch scans. Module-scoped scan state survives unmount and the progress banner reappears on return.
- **SSE stale sweep timer on re-initialization** — Stale client sweep interval now starts even when `init()` is called after a hot reload, preventing leaked SSE connections.
- **About modal documentation icon** — Documentation link in the about modal now shows a book icon instead of the expand/maximize icon.
- **Log auto-fetch pauses in background tabs** — `useAutoFetchLogs` now stops polling when the browser tab is hidden and automatically resumes when it becomes visible again.
- **SBOM download DOM isolation** — Isolated DOM element creation and `URL.createObjectURL` references in the SBOM download composable, fixing potential memory leaks and test failures from uncleared object URLs. JSON serialization skipped when SBOM panel is hidden.
- **Dashboard resource fetch error propagation** — Dashboard API fetch errors are now propagated consistently to the UI error state instead of being silently swallowed.
- **Docker image "latest" tag restricted to stable releases** — CI release workflow no longer tags prerelease versions as `latest`, preventing unstable images from being pulled by default.
- **Security table refreshes progressively during batch scan** — Security view table updates incrementally as each container scan completes instead of waiting for the entire batch to finish.
- **Vulnerability data fetched from per-container endpoint** — Security view now fetches vulnerability data from the correct per-container endpoint instead of a missing bulk endpoint.
- **OIDC callback session loss with cross-site IdPs** — Session cookies now default to `SameSite=Lax` for auth compatibility, fixing callback flows that could fail under `SameSite=Strict`. Added `DD_SERVER_COOKIE_SAMESITE` (`strict|lax|none`) for explicit control. ([#52](https://github.com/CodesWhat/drydock/issues/52))
- **Compose trigger handles unknown update kinds** — Containers with `updateKind.kind === 'unknown'` now trigger `docker compose pull` instead of silently skipping. ([#91](https://github.com/CodesWhat/drydock/issues/91))
- **Compose image patching uses structured YAML edits** — Replaced regex/indent heuristics with YAML parser targeting only `services.<name>.image`, preserving comments and formatting.
- **Hub/DHI public registries preserved with legacy token envs** — Public registry fallback no longer lost when a private token is configured. Fail-closed behavior remains for private registry auth and runtime token exchange failures.
- **GHCR retries anonymously on credential rejection** — Public image checks continue when configured credentials are rejected by GHCR/LSCR.
- **Partial registry registration failures isolated** — `Promise.allSettled` prevents a single bad registry from taking down all registries including the public fallback.
- **Auth-blocked remote watchers stay registered** — Remote watchers that fail auth now show as degraded instead of crashing watcher init.
- **Docker event stream reconnects with exponential backoff** — Watcher reconnects automatically (1s doubling to 30s max) instead of staying disconnected after Docker socket interruption.
- **SSE frames flushed immediately** — Added `X-Accel-Buffering: no` and explicit `flush()` to prevent nginx/traefik from buffering real-time events.
- **Store flushed on graceful shutdown** — Explicit `save()` call on SIGTERM/SIGINT prevents data loss between autosave intervals.
- **Digest value populated on registration and refresh** — Digest-watch containers no longer show undefined digest in the UI.
- **Icon fallback for missing upstream** — Icon proxy returns bundled Docker fallback instead of 404 when upstream providers return 403/404. Fixes registry port parsing in icon URLs.
- **Container groups route no longer shadowed** — `/containers/groups` mounted before `/containers/:id` to prevent Express treating group requests as container ID lookups.
- **Runtime env values redacted in API responses** — Container environment variable values no longer exposed through the API.
- **Logger init failure produces structured stderr** — Falls back to structured JSON on stderr instead of silent no-op when logger init fails.
- **Mobile sidebar closes on route change** — Safety-net watcher ensures mobile menu closes on any navigation.
- **Security badge counts only scan vulnerabilities** — No longer inflated by major version updates.
- **Trigger test failure shows parsed error message** — Actionable error reason displayed below trigger card on test failure.
- **Viewport scrollbar eliminated** — Fixed double-nested scroll contexts; long tags truncated with tooltips.
- **Self-hosted registries ignore port when matching** — Registry matching now respects port numbers in self-hosted registry URLs, preventing mismatches between registries on different ports of the same host.
- **Socket proxy ECONNREFUSED with `:ro` mount** — Removed `:ro` flag from Docker socket mount in all socket proxy compose examples. The read-only flag can prevent the proxy from connecting to the Docker daemon on some Linux kernels; the proxy's environment variable filtering (`CONTAINERS=1`, `EVENTS=1`, etc.) is the actual security boundary. Added health check and `depends_on: condition: service_healthy` to all socket proxy examples for proper startup ordering. Added FAQ entry for troubleshooting ECONNREFUSED with socket proxies.
- **Apprise trigger missing Content-Type header** — Apprise notify requests now set explicit `Content-Type: application/json` header, fixing failures with Apprise servers that require it.
- **Toggle switch contrast** — Improved toggle thumb contrast across all themes for better visibility.
- **Empty env var values rejected during container validation** — Joi schema on `details.env[].value` used `.string().required()` which implicitly disallows empty strings. Containers with empty environment variable values (e.g. `FOO=`) were silently skipped during watch cycles. Fixed with `.allow('')`. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **OIDC login broken by same-origin redirect check** — `LoginView.vue` restricted OIDC redirects to same-origin URLs, but OIDC Identity Provider URLs are always cross-origin (Authentik, Keycloak, etc.). Removed the same-origin check, keeping only HTTP/HTTPS protocol validation.
- **Blank white screen on plain HTTP deployments** — Helmet.js defaults enabled HSTS and `upgrade-insecure-requests` CSP even when TLS was not configured, causing browsers to block sub-resource loads on plain HTTP. Now conditionally omits `upgrade-insecure-requests` and HSTS when TLS is off. Strict boolean check on `tls.enabled` prevents string coercion. ([#120](https://github.com/CodesWhat/drydock/discussions/120))
- **Stale theme preferences after upgrade from v1.3** — Preferences migration `deepMerge` overwrote defaults with persisted values unconditionally, so invalid enum values (e.g. removed `drydock` theme family) survived migration and caused rendering failures. Added `sanitize()` pass that strips invalid theme families, variants, font families, icon libraries, scales, radius presets, view modes, and table actions before merge.
- **OIDC discovery fails on HTTP IdP URLs** — openid-client v6 enforces HTTPS by default for all OIDC requests. Users running IdPs behind reverse proxies or on private networks with HTTP discovery URLs got "only requests to HTTPS are allowed" errors. Now passes `allowInsecureRequests` when the discovery URL protocol is `http:`.
- **Docker Compose trigger fails with EBUSY on bind-mounted stacks** — `writeComposeFileAtomic()` used a single `fs.rename()` call that failed permanently when another process (e.g. Dockge) held the file or when Docker bind-mount overlay contention blocked the rename. Now retries up to 5 times with 200ms backoff, then falls back to a direct `writeFile` if rename remains blocked. ([#84](https://github.com/CodesWhat/drydock/discussions/84))
- **Drydock container display name hardcoded** — The Docker watcher hardcoded `drydock` as the display name for drydock's own container instead of using the actual container name like every other container.
- **Non-existent DD_OIDC_ALLOW_HTTP env var referenced in UI** — The UI OIDC HTTP banner referenced a `DD_OIDC_ALLOW_HTTP` env var that does not exist — the backend auto-detects `http://` discovery URLs and passes `allowInsecureRequests` automatically. Removed the misleading reference.
- **Load test and start scripts broken by standardized API responses** — `jq` queries in `run-load-test.sh` and `start-drydock.sh` used raw array syntax instead of `.data[]` to match the new collection response pattern.
- **Container status not reconciled on cron poll** — Containers that changed state between Docker event stream updates (e.g. stopped externally) were not reconciled during periodic cron polls. Now reconciles container status on each poll cycle.
- **DD_AUTH_ANONYMOUS_CONFIRM env var alias rejected** — `DD_AUTH_ANONYMOUS_CONFIRM` was not accepted as an alias for the canonical `DD_ANONYMOUS_AUTH_CONFIRM` env var, forcing users to use only the non-prefixed form.
- **LSCR cross-host auth failure** — LinuxServer Container Registry (lscr.io) token exchange failed because the auth flow required cross-host authentication via the ghcr.io token endpoint. Now allows cross-host auth for lscr.io.
- **iPad sidebar clipping** — Used `dvh` (dynamic viewport height) instead of `vh` for sidebar height to fix clipping on iPad and other mobile browsers where the toolbar reduces available viewport height.
- **Mobile dashboard scroll clipping** — Dashboard content was clipped on mobile viewports when scrolling, preventing users from reaching all content.
- **Lockout counter reset on failed login** — Brute-force lockout counter could reset prematurely, and strategy IDs were not protected from enumeration. Fixed counter persistence and added strategy ID protection.
- **Stale vulnerability data on fetch error** — Security view retained stale vulnerability data when a fetch error occurred instead of clearing it, showing outdated information.
- **Audit service missing limit parameter** — Audit service requests did not always send the `limit` query parameter, causing inconsistent pagination behavior.
- **Backup retention on failed updates** — Backup entries are now pruned on the failure path, not just after successful updates, preventing indefinite accumulation of stale backups.
- **Backup pruning with undefined maxCount** — `pruneOldBackups()` no longer deletes all backups when `maxCount` is `undefined` (e.g. when `DD_BACKUPCOUNT` is not configured). Now correctly no-ops on invalid or non-finite values.
- **Auto-rollback audit fromVersion accuracy** — Rollback audit entries now correctly record `fromVersion` as the failing new image tag (via `updateKind.remoteValue`) instead of the pre-update old tag.
- **HASS entity_picture URL broken after logo rename** — MQTT HASS discovery payload referenced a renamed logo file (`drydock.png` instead of `whale-logo.png`), causing missing entity pictures in Home Assistant. ([#138](https://github.com/CodesWhat/drydock/issues/138))
- **Watcher crashes on containers with empty names** — Docker watcher's same-name deduplication filter threw errors when containers had empty or missing names. Now skips deduplication for unnamed containers.
- **Container names not reconciled after external recreate** — Containers recreated externally (via Portainer or `docker compose up`) retained stale names in the store until the next full poll cycle. Now reconciles container names immediately on detection.
- **Nested icon prefixes fail proxy request** — Icon proxy rejected icons with doubled prefixes like `mdi:mdi-docker`. Now normalizes nested prefixes before proxying.
- **Colon-separated icon prefixes rejected** — `dd.display.icon` labels using colon separators (e.g., `sh:nextcloud`) were rejected by the API validation pattern. Validation now accepts colon-prefixed icon identifiers.
- **Bouncer-blocked state missing from container details** — Container detail views didn't reflect bouncer-blocked status. Now correctly wires the blocked state into detail panel display.

### Security

- **Security API error sanitization** — SBOM and scan error responses now return generic messages (`Error generating SBOM`, `Security scan failed`) instead of leaking internal error details. Detailed errors logged server-side only.
- **Agent log query parameter validation** — Agent log level and component query parameters are validated against an allowlist and safe-character pattern, returning 400 for invalid values.
- **TLS key/cert paths stripped from config response** — Server configuration API response no longer includes filesystem paths for TLS private key and certificate files.
- **Type-safe store and auth modules** — Settings, notification, and auth store modules upgraded from `any` to explicit typed interfaces, preventing implicit type coercion vulnerabilities.
- **Fail-closed auth enforcement across registries and triggers** — Bearer token, OIDC, and credential flows use `failClosedAuth` with typed `RequestOptions`, rejecting requests when required credentials are missing.
- **Input validation hardened** — Additional input validation and error redaction across auth, API, and configuration modules.
- **Mutation-only JSON body parser** — Express JSON body parsing restricted to mutation methods (POST/PUT/PATCH) only on both API and auth routers, reducing attack surface on read requests.
- **CSRF Sec-Fetch-Site validation** — CSRF middleware now rejects requests with `Sec-Fetch-Site: cross-site` header, blocking cross-site state-changing requests even when the Origin header is absent.
- **HTTPS enforcement for SameSite=none cookies** — `DD_SERVER_COOKIE_SAMESITE=none` now requires HTTPS configuration (`DD_SERVER_TLS_ENABLED=true` or `DD_SERVER_TRUSTPROXY`) and throws at startup if neither is set.
- **Remember-me endpoint requires authentication** — `/auth/remember` POST moved after `requireAuthentication` middleware, preventing unauthenticated access.
- **Env reveal rate limit tightened** — `/api/containers/:id/env` rate limit reduced from 100/min to 10/min to prevent credential enumeration. Server error responses return generic messages instead of internal details.
- **Trivy command path validation** — Trivy binary paths are validated against shell metacharacters and path traversal before execution.
- **Digest scan cache LRU eviction** — Scan result cache uses LRU eviction (max 500 entries, configurable via `DD_SECURITY_SCAN_DIGEST_CACHE_MAX_ENTRIES`) to prevent unbounded memory growth. Trivy DB status lookups are deduplicated across concurrent calls.
- **CSP configured for Iconify CDN** — Content-Security-Policy updated to allow `connect-src` for the Iconify CDN origin, preventing blocked icon fetches in the browser.
- **CSP connect-src restricted in internetless mode** — Content-Security-Policy `connect-src` directive tightened to `'self'` when running in internetless mode, blocking outbound connections from the browser.
- **Legacy auth methods endpoint rate-limited** — `/api/auth/methods` rate-limited to prevent enumeration of available authentication providers.
- **Removed plaintext credentials from login request body** — The Basic auth login was redundantly sending username and password in both the Authorization header and the JSON body. The backend only reads the Authorization header via Passport, so the body credentials were unnecessary exposure.
- **Server-issued SSE client identity** — Self-update ack requests validated against server-issued tokens, preventing spoofed acknowledgments.
- **Fail-closed auth across watchers, registries, and triggers** — Token exchange failures no longer fall through to anonymous access.
- **Runtime env values redacted** — Container environment variable values stripped from API responses to prevent credential leakage.
- **OIDC authorization redirect URL validation** — Added allowlist-based validation for OIDC authorization redirect URLs, preventing open redirect attacks through crafted callback parameters.
- **Auth, registry token, and log sanitization hardening** — Consolidated security pass hardening authentication flows, registry token validation, and log output sanitization.
- **Command trigger shell execution warning** — Command trigger now logs a one-time security warning on first execution, reminding operators that commands run with drydock process privileges.
- **Login brute-force lockout** — Per-account and per-IP lockout after configurable failed login attempts (`DD_AUTH_ACCOUNT_LOCKOUT_MAX_ATTEMPTS`, `DD_AUTH_IP_LOCKOUT_MAX_ATTEMPTS`) with configurable window and duration.
- **Concurrent session limits** — Maximum authenticated sessions per user (default 5, configurable via `DD_SERVER_SESSION_MAXCONCURRENTSESSIONS`). Oldest sessions are revoked first when the limit is reached.
- **Destructive action confirmation header** — Dangerous operations (delete container, restore backup, delete all containers) now require an `X-DD-Confirm-Action` header, returning 428 when missing.
- **Native argon2id password hashing** — Replaced abandoned `pass` package with `node:crypto` argon2Sync for Basic auth. OWASP-aligned parameters with timing-safe comparison. Legacy `{SHA}` hashes accepted with deprecation warnings.
- **Full credential redaction** — `Component.mask()` now returns `[REDACTED]` instead of leaking prefix/suffix characters in logs and API responses.
- **Trigger infrastructure config redaction** — Webhook URLs, hostnames, channels, and usernames are redacted from trigger configuration in API responses.
- **Website SRI integrity hashes** — Post-build script injects subresource integrity hashes for static assets on the documentation website.
- **Fail-closed webhook token enforcement** — Per-endpoint webhook tokens now fail closed when a token is configured but the request provides no token or a mismatched token, preventing bypass through missing headers.
- **API error message sanitization** — API routes no longer expose raw Joi validation or exception messages to clients. New `sanitizeApiError()` helper returns generic messages while logging real details server-side.
- **Trigger request body schema validation** — `POST /api/triggers/:type/:name` and remote trigger endpoints now validate request bodies with Joi (require `id` string, reject type coercion via `convert: false`).
- **HTTP trigger auth schema enforcement at startup** — HTTP trigger Joi schema now conditionally requires `user`+`password` for BASIC auth and `bearer` for BEARER auth at registration time, catching misconfigurations before first trigger execution.
- **CORS implicit wildcard origin deprecation warning** — Startup warning when `DD_SERVER_CORS_ENABLED=true` without explicit `DD_SERVER_CORS_ORIGIN`. Default wildcard will require explicit opt-in in v1.5.0.
- **Identity-aware rate limit keying** — Opt-in `DD_SERVER_RATELIMIT_IDENTITYKEYING=true` keys authenticated route rate limits by session/username instead of IP, preventing collisions for multiple users behind shared proxies. Unauthenticated routes remain IP-keyed. Disabled by default.
- **Reactive server feature flags in UI** — Container action buttons (update, rollback, scan, triggers) are now gated by server-side feature flags via a `useServerFeatures` composable. When features like `DD_SERVER_FEATURE_CONTAINERACTIONS` are disabled, buttons show a disabled state with tooltip explaining why instead of silently failing at runtime.
- **Compose trigger hardening** — Auto compose file detection from container labels (`com.docker.compose.project.config_files`) with Docker inspect fallback, pre-commit `docker compose config --quiet` validation before writes, compose file reconciliation (warn/block modes for runtime vs compose image drift), optional digest pinning (`DIGESTPINNING` trigger config), compose-file-once batch mode for multi-service stacks, multi-file compose chain awareness with deterministic writable target selection, compose metadata in update preview API, and compose file path display in container detail UI.
- **Unsupported hash formats fail closed** — Basic auth now rejects unsupported hash formats instead of falling through to plaintext comparison, preventing accidental plaintext password acceptance.

### Performance

- **Production source maps disabled** — UI production builds now exclude source maps, reducing bundle size and improving deployment efficiency.
- **Audit store indexed date-range queries** — Audit entries now store a pre-parsed `timestampMs` index for numeric comparisons. Date-range queries use the LokiJS chain API with indexed filtering instead of full-collection scans. Automatic 30-day retention with periodic pruning.
- **Backup store indexed lookups** — Backup collection adds indices on `data.containerName` and `data.id`, using `findOne()` for single-document lookups and indexed `find()` for name-filtered queries instead of full scans.
- **LokiJS autosave interval set to 60 seconds** — Fixed autosave interval at 60s instead of the LokiJS default, reducing disk I/O while maintaining acceptable data durability.
- **SSE shared heartbeat interval** — Deduplicated per-client SSE heartbeat timers into a single shared interval that starts on first connection and stops when all clients disconnect.
- **LoginView exponential backoff** — Login page connectivity retry uses exponential backoff (5s doubling to 30s max) instead of fixed intervals, reducing server load during outages.
- **Gzip response compression** — API responses compressed above configurable threshold with automatic SSE exclusion.
- **Skip connectivity polling when SSE connection is active** — Eliminates unnecessary `/auth/user` fetches every 10s during normal operation.
- **Set-based lookups replace linear scans** — Repeated array lookups converted to Set operations in core paths.
- **Vite chunk splitting** — Production build now splits vendor code into `framework`, `icons`, and `vendor` chunks for better browser cache efficiency across deployments.
- **Session index cache with atomic login locks** — Auth session lookups use an indexed cache for O(1) access. Login operations use atomic locks to prevent race conditions during concurrent authentication attempts.
- **Proactive store cache eviction** — LokiJS store proactively evicts stale cache entries before insertion, reducing memory pressure during high-throughput container watch cycles.
- **Async secret file loading** — Secret file loading (`DD_*__FILE` env vars) uses `fs/promises` for non-blocking reads during startup configuration, improving initialization time with many secret files.

### Dependencies

- **cron-parser v2 to v5** — Upgraded `cron-parser` from v2 to v5 (`CronExpressionParser` API). Note: `joi-cron-expression` still uses cron-parser v2 internally as its own dependency.
- **Removed `pass` package** — Replaced abandoned `pass` password hashing with native `node:crypto` (covered under Security below).
- **Trivy upgraded to 0.69.3** — Bumped Trivy version in qlty configuration for latest vulnerability database and scanner improvements.

### Deprecated

- **SHA-1 basic auth password hashes** — Legacy `{SHA}<base64>` password hashes are accepted with deprecation warnings. SHA-1 support will be removed in v1.6.0. Migrate to argon2id hashing.

## [1.3.9] — 2026-02-22

### Fixed

- **Release signing broken by cosign v3 API change** — `cosign sign-blob` v3 silently ignores `--output-signature` and `--output-certificate` in keyless OIDC mode, producing an empty `.sig` file that fails upload. Release workflow now extracts signature and certificate from the cosign `.bundle` JSON as a fallback, handling both old (`base64Signature`/`cert`) and new (`messageSignature.signature`/`verificationMaterial.certificate.rawBytes`) bundle formats.
- **Shellcheck SC2086 in release signing step** — Unquoted `${TAGS}` expansion in container image signing replaced with `read`-loop into array to eliminate word-splitting/globbing risk.

### Changed

- **CI and lefthook now run identical lint checks** — CI lint job previously ran `qlty check --filter biome` (1 plugin) while lefthook ran `qlty check` (17 plugins). Both now run `qlty check --all` from the repo root, ensuring local pre-push catches exactly what CI catches.
- **Pre-commit hook auto-fixes lint issues** — `qlty check --fix` runs on staged files at commit time, followed by a verify step. Lint drift no longer accumulates until push time.
- **Lefthook pre-push is sequential fail-fast** — Switched from `piped: false` (parallel) to `piped: true` with priority ordering so failures surface immediately with clear output.

## [1.3.8] — 2026-02-22

### Fixed

- **Docker Compose trigger silently no-ops for `updateKind: unknown`** — When the update model classifies a change as `unknown` (e.g. created-date-only updates, unrecognized tag formats), `getNewImageFullName` resolved the update image identically to the current image, causing both compose-update and runtime-update filters to return empty arrays and log "All containers already up to date". The runtime-update filter now also triggers when `container.updateAvailable === true`, ensuring containers with confirmed updates are recreated regardless of `updateKind` classification. Compose file rewrites remain gated on explicit tag deltas. ([#91](https://github.com/CodesWhat/drydock/issues/91))
- **Digest watch masks tag updates, pulling old image** — When digest watch was enabled on a container with both a tag change and a digest change (e.g. `v2.59.0-s6` → `v2.60.0-s6`), the update model gave digest unconditional priority, returning `kind: 'digest'` instead of `kind: 'tag'`. The trigger then resolved the image to the current tag (correct for digest-only updates) instead of the new tag, pulling the old image. Tag updates now take priority over digest when both are present. This bug was inherited from the upstream project (WUD). ([#91](https://github.com/CodesWhat/drydock/issues/91))
- **Database not persisted on container shutdown** — LokiJS relies on its autosave interval to flush data to disk, but the graceful shutdown handler called `process.exit()` before the next autosave tick could fire, causing any in-memory changes since the last autosave to be lost. This manifested as stale version numbers, lost update policies, and missing audit log entries after restarting the drydock container. Now explicitly saves the database during shutdown before exiting. This bug was inherited from the upstream project (WUD) but made deterministic by our graceful shutdown changes. ([#96](https://github.com/CodesWhat/drydock/issues/96))

## [1.3.7] — 2026-02-21

### Fixed

- **Tag regex OOM crash with re2-wasm** — Replaced `re2-wasm` with `re2js` (pure JavaScript RE2 port). The WASM binary had a hard 16 MB memory ceiling with no growth allowed, causing `abort()` crashes on valid regex patterns like `^v(\d+\.\d+\.\d+)-ls\d+$`. Since `re2-wasm` is abandoned (last npm publish Sep 2021) with no path to a fix, `re2js` provides the same linear-time ReDoS protection without WASM memory limits or native compilation requirements. ([#89](https://github.com/CodesWhat/drydock/issues/89))
- **Self-signed/private CA support for self-hosted registries** — Added optional `CAFILE` and `INSECURE` TLS options for self-hosted registry providers (Custom, Gitea, Forgejo, Harbor, Artifactory, Nexus). This allows private registries with internal or self-signed certificates to pass TLS validation via a mounted CA bundle, or to explicitly disable verification for trusted internal networks. ([#88](https://github.com/CodesWhat/drydock/issues/88))
- **Docker Compose trigger silently no-ops on digest updates** — Digest-only updates (same tag, new image hash) were filtered out entirely because the compose image string didn't change, causing the trigger to report success without recreating the container. Now digest updates skip the compose file write (correct — tag hasn't changed) but still trigger container recreation to pull the new image. ([#91](https://github.com/CodesWhat/drydock/issues/91))

### Changed

- **Gitea refactored to shared base class** — Gitea now extends `SelfHostedBasic` directly instead of duplicating its logic from `Custom`, reducing code and ensuring consistent behavior with Harbor, Nexus, and Artifactory.
- **Lint tooling migrated from biome CLI to qlty** — Removed `@biomejs/biome` as a direct devDependency from all workspaces; biome is now managed centrally via qlty. Lint and format scripts updated to use `qlty check`/`qlty fmt`.
- **Dependabot replaced with Renovate** — Switched dependency update bot for better monorepo grouping, auto-merge of patch updates, and pinned GitHub Actions digests.
- **Socket Firewall switched to free mode** — The CI supply chain scan now uses `firewall-free` (blocks known malware, no token required) instead of `firewall-enterprise`.
- **CI pipeline improvements** — Added npm and Docker layer caching, parallelized e2e/load-test jobs, reordered job dependencies for faster feedback, added harden-runner to all workflow jobs.
- **CI credential hardening** — Bumped `harden-runner` v2.11.1 → v2.14.2 (fixes GHSA-cpmj-h4f6-r6pq) and added `persist-credentials: false` to all `actions/checkout` steps across all workflows to prevent credential leakage through artifacts.
- **Zizmor added to local pre-push checks** — GitHub Actions security linter now runs via qlty alongside biome, catching workflow misconfigurations before push.
- **Lefthook pre-push runs piped** — Commands now run sequentially with fail-fast instead of parallel, so failures surface immediately instead of hanging while other commands complete.

## [1.3.6] — 2026-02-20

### Fixed

- **GHCR anonymous auth returns 401 on public repos** — The v1.3.3 fix for anonymous bearer tokens (`Og==`) removed the auth header entirely, but GHCR requires a token exchange even for unauthenticated pulls. Replaced direct bearer auth with proper token exchange via `https://ghcr.io/token`, matching the Hub/Quay pattern. Authenticated requests add Basic credentials to the token request; anonymous requests omit them. LSCR inherits the fix automatically. ([#85](https://github.com/CodesWhat/drydock/issues/85), [#86](https://github.com/CodesWhat/drydock/issues/86))

## [1.3.5] — 2026-02-19

### Fixed

- **Container exits immediately when socket GID has no named group** — `Docker.entrypoint.sh` treated `getent group <gid>` failures as fatal under `set -e -o pipefail`, so mounts where `/var/run/docker.sock` had a numeric GID not present in `/etc/group` caused an immediate exit (`status=exited`, `exit=2`) before app startup. The group lookup is now tolerant and falls back to creating a matching group as intended. ([#82](https://github.com/CodesWhat/drydock/issues/82))
- **Log pretty-printing no longer depends on shell pipes** — Moved human-readable formatting from the entrypoint pipeline (`node | pino-pretty`) into the app logger configuration. This preserves proper `exec`/signal behavior under `tini` while keeping `DD_LOG_FORMAT=json` support.

## [1.3.4] — 2026-02-19

### Fixed

- **Backup lookup broken after container update** — Backups were keyed by Docker container ID, which changes on every recreate (e.g. after an update). Switched all backup queries to use the stable container name, so backups are always found regardless of container ID changes. ([#79](https://github.com/CodesWhat/drydock/issues/79))
- **Image prune deletes backup image** — `cleanupOldImages` removed the previous image tag after updates, making rollback impossible. Now checks retained backup tags before pruning and skips images that are needed for rollback.
- **Auto-rollback monitor uses stale container ID** — After an update recreates the container, `maybeStartAutoRollbackMonitor` passed the old (now-deleted) container ID to the health monitor. Now looks up the new container by name and passes the correct ID.
- **Backup stores internal registry name instead of Docker-pullable name** — Backup `imageName` was stored as the internal registry-prefixed name (e.g. `hub.public/library/nginx`) which is not a valid Docker image reference. Rollback would fail with DNS lookup errors. Now stores the Docker-pullable base name (e.g. `nginx`) using the registry's `getImageFullName` method.
- **Rollback API docs incorrect endpoint** — Fixed documentation showing `/api/backup/:id/rollback` instead of the correct `/api/containers/:id/rollback`.

## [1.3.3] — 2026-02-18

### Fixed

- **Self-update leaves container stopped** — When drydock updated its own container, stopping the old container killed the Node process before the new one could be created, leaving the UI stuck on "Restarting..." indefinitely. Now uses a helper container pattern: renames old container, creates new container, then spawns a short-lived helper that curls the Docker socket to stop old → start new → remove old. ([#76](https://github.com/CodesWhat/drydock/issues/76))
- **Stale digest after container updates** — After a container was updated (new image pulled, container recreated), the next watch cycle still showed the old digest because the early-return path in `addImageDetailsToContainer` skipped re-inspecting the Docker image. Now re-inspects the local image on each watch cycle to refresh digest, image ID, and created date. ([#76](https://github.com/CodesWhat/drydock/issues/76))
- **express-rate-limit IPv6 key generation warning** — Removed custom `keyGenerator` from the container scan rate-limiter that bypassed built-in IPv6 normalization, causing `ERR_ERL_KEY_GEN_IPV6` validation errors.
- **express-rate-limit X-Forwarded-For warning** — Added `validate: { xForwardedForHeader: false }` to all 6 rate-limiters to suppress noisy `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warnings when running without `trust proxy` (e.g. direct Docker port mapping).
- **Quay auth token extraction broken** — Fixed `authenticate()` reading `response.token` instead of `response.data.token`, causing authenticated pulls to silently run unauthenticated. Also affects Trueforge via inheritance.
- **GHCR anonymous bearer token** — Fixed anonymous configurations sending `Authorization: Bearer Og==` (base64 of `:`) instead of no auth header, which could break public image access.
- **Created-date-only updates crash trigger execution** — Fixed `getNewImageFullName()` crashing on `.includes()` of `undefined` when a container had only a created-date change (no tag change). Now rejects `unknown` update kind in threshold logic.
- **Compose write failure allows container updates** — Fixed `writeComposeFile()` swallowing errors, allowing `processComposeFile()` to proceed with container updates even when the file write failed, causing runtime/file state desynchronization.
- **Self-update fallback removes running old container** — Fixed helper script running `removeOld` after the fallback path (`startOld`), which would delete the running old container. Now only removes old after successful new container start.
- **Registry calls have no timeout** — Added 30-second timeout to all registry API calls via Axios. Previously a hung registry could stall the entire watch cycle indefinitely.
- **HTTP trigger providers have no timeout** — Added 30-second timeout to all outbound HTTP trigger calls (Http, Apprise, Discord, Teams, Telegram). Previously a slow upstream could block trigger execution indefinitely.
- **Kafka producer connection leak** — Fixed producer connections never being disconnected after send, leaking TCP connections to the broker over time. Now wraps send in try/finally with disconnect.
- **Rollback timer labels not validated** — Invalid `dd.rollback.window` or `dd.rollback.interval` label values (NaN, negative, zero) could cause `setInterval` to fire continuously. Now validates with `Number.isFinite()` and falls back to defaults.
- **Health monitor overlapping async checks** — Added in-flight guard to prevent overlapping health checks from triggering duplicate rollback executions when inspections take longer than the poll interval.
- **Anonymous login double navigation guard** — Fixed `beforeRouteEnter` calling `next()` twice when anonymous auth was enabled, causing Vue Router errors and nondeterministic redirects.
- **Container API response not validated** — Fixed `getAllContainers()` not checking `response.ok` before parsing, allowing error payloads to be treated as container arrays and crash computed properties.

### Security

- **fast-xml-parser DoS via entity expansion** — Override `fast-xml-parser` 5.3.4→5.3.6 to fix CVE GHSA-jmr7-xgp7-cmfj (transitive dep via `@aws-sdk/client-ecr`, upstream hasn't released a fix yet).
- **tar arbitrary file read/write** — Removed `tar` from dependency graph entirely by replacing native `re2` (which pulled in `node-gyp` → `tar`) with `re2-wasm` (v1.3.3), later replaced by `re2js` (v1.3.7) due to WASM memory limits. Previously affected by CVE GHSA-83g3-92jg-28cx.
- **Unauthenticated SSE endpoint** — Moved `/api/events/ui` behind `requireAuthentication` middleware and added per-IP connection limits (max 10) to prevent connection exhaustion.
- **Session cookie missing sameSite** — Set `sameSite: 'strict'` on session cookie to mitigate CSRF attacks.
- **Predictable session secret** — Added `DD_SESSION_SECRET` environment variable override so deployments can provide proper entropy instead of the default deterministic UUIDv5.
- **Global error handler leaks internal details** — Replaced `err.message` with generic `'Internal server error'` in the global error handler to prevent leaking hostnames, paths, and Docker socket info to unauthenticated callers.
- **Entrypoint masks crash exit codes** — Enabled `pipefail` in `Docker.entrypoint.sh` so `node | pino-pretty` correctly propagates non-zero exit codes for restart policies.

## [1.3.2] — 2026-02-16

### Added

- **Log viewer auto-fetch polling** — Configurable auto-fetch interval (Off / 2s / 5s / 10s / 30s) for both application and container log viewers, replacing manual-only refresh. Defaults to 5 seconds for a near-real-time tail experience. ([#57](https://github.com/CodesWhat/drydock/issues/57))
- **Log viewer scroll lock** — Scrolling away from the bottom pauses auto-scroll, showing a "Scroll locked" indicator and "Resume" button. New log data continues to load in the background without yanking the user's scroll position. ([#57](https://github.com/CodesWhat/drydock/issues/57))
- **Log viewer auto-scroll** — New log entries automatically scroll the view to the bottom when the user is near the end, providing a tail-like experience. ([#57](https://github.com/CodesWhat/drydock/issues/57))
- **Shared log viewer composable** — Extracted `useLogViewerBehavior` composable with `useLogViewport` (scroll management) and `useAutoFetchLogs` (interval timer lifecycle) to eliminate duplication between application and container log views.
- **7 new registry providers** — Added OCIR (Oracle Cloud), IBMCR (IBM Cloud), ALICR (Alibaba Cloud), GAR (Google Artifact Registry), Harbor, JFrog Artifactory, and Sonatype Nexus. Includes a shared `SelfHostedBasic` base class for self-hosted registries with basic auth.
- **4 new trigger providers** — Added Mattermost, Microsoft Teams (Adaptive Cards), Matrix, and Google Chat notification triggers.

### Fixed

- **v1 manifest digest watch using image ID instead of repo digest** — Fixed `handleDigestWatch()` incorrectly reading `Config.Image` (the local image ID) as the digest for v1 manifest images, causing perpetual false "update available" notifications. Now uses the repo digest from `RepoDigests` instead. ([getwud/wud#934](https://github.com/getwud/wud/issues/934))
- **Discord trigger broken after request→axios migration** — Fixed `sendMessage()` using `request`-style properties (`uri`, `body`) instead of axios properties (`url`, `data`), causing "Invalid URL" errors on all Discord webhook calls. ([getwud/wud#933](https://github.com/getwud/wud/issues/933))

## [1.3.1] — 2026-02-15

### Fixed

- **Release SBOM generation for multi-arch images** — Replaced `anchore/sbom-action` (which fails on manifest list digests from multi-platform builds) with Docker buildx native SBOM generation (`sbom: true`), producing per-platform SBOMs embedded in image attestations.

### Security

- **Pin Trivy install script by commit hash** — Replaced mutable `main` branch reference in Dockerfile `curl | sh` with a pinned commit SHA to satisfy OpenSSF Scorecard pinned-dependencies check and prevent supply-chain risk from upstream changes.

## [1.3.0] — 2026-02-15

### Fixed

- **OIDC session resilience for WUD migrations** — Corrupt or incompatible session data (e.g. from WUD's connect-loki store) no longer causes 500 errors. Sessions that fail to reload are automatically regenerated. All OIDC error responses now return JSON instead of plain text, preventing frontend parse errors. Added a global Express error handler to ensure unhandled exceptions return JSON.
- **Disabled X-Powered-By header** — Removed the default Express `X-Powered-By` header from both the main API and agent API servers to reduce information exposure.
- **Trivy scan queue** — Serialized concurrent Trivy invocations to prevent `"cache may be in use by another process"` errors when multiple containers are scanned simultaneously (batch triggers, on-demand scans, SBOM generation).
- **Login error on wrong password** — `loginBasic()` attempted to parse the response body as JSON even on 401 failures, causing `Unexpected token 'U', "Unauthorized" is not valid JSON` errors instead of the friendly "Username or password error" message.
- **Snackbar notification colors ignoring level** — The SnackBar component had a hardcoded `color="primary"` instead of binding to the `level` prop, causing error and warning notifications to display as blue instead of red/amber.
- **SBOM format key mismatch** — Fixed container model schema validating SBOM formats against `cyclonedx` instead of the correct `cyclonedx-json` key.

### Added

- **Snyk vulnerability monitoring** — Integrated Snyk for continuous dependency scanning of `app/package.json` and `ui/package.json`. Added Snyk badge to README with `targetFile` parameter for monorepo support.
- **Update Bouncer (Trivy safe-pull gate)** — Added pre-update vulnerability scanning for Docker-triggered updates. Candidate images are scanned before pull/restart, updates are blocked when vulnerabilities match configured blocking severities, and latest scan data is persisted on `container.security.scan`. Added `GET /api/containers/:id/vulnerabilities` endpoint for retrieving scan results.
- **Update Bouncer signature verification (cosign)** — Added optional pre-update image signature verification. When enabled, Docker-triggered updates are blocked if candidate image signatures are missing/invalid or verification fails.
- **Update Bouncer SBOM generation** — Added Trivy SBOM generation (`spdx-json`, `cyclonedx-json`) for candidate images with persistence in `container.security.sbom` and a new `GET /api/containers/:id/sbom` API endpoint (with `format` query support).
- **Container card security status chip** — Added a vulnerability chip on container cards showing Update Bouncer scan status (`safe`, `blocked`, `scan error`) with severity summary tooltip data from `container.security.scan`.
- **On-demand security scan** — Added `POST /api/containers/:id/scan` endpoint for triggering vulnerability scan, signature verification, and SBOM generation on demand. Broadcasts `dd:scan-started` and `dd:scan-completed` SSE events for real-time UI feedback. Added shield button to container card actions and mobile overflow menu.
- **Direct container update from UI** — Added `POST /api/containers/:id/update` endpoint that triggers a Docker update directly without requiring trigger configuration. The "Update now" button in the UI now calls this single endpoint instead of looping through configured triggers.
- **Trivy and cosign in official image** — The official drydock image now includes both `trivy` and `cosign` binaries, removing the need for custom images in local CLI mode.

### Changed

- **README badge layout** — Added line breaks to badge rows for a cleaner two-line layout across all three badge sections.
- **Grafana dashboard overhaul** — Updated overview dashboard with standard datasource naming (`DS_PROMETHEUS`), added bar chart and pie chart panels, and restructured panel layout for better monitoring coverage.
- **Mobile responsive dashboard** — Stat cards now stack full-width on small screens with tighter vertical spacing for a cleaner mobile layout.
- **Self-update overlay rendering** — Switched logo images from `v-if` to `v-show` to avoid re-mount flicker during self-update phase transitions.
- **Container sort simplification** — Simplified null-group sorting in ContainersView using sentinel value instead of multi-branch conditionals.
- **Test coverage improvements** — Expanded app test coverage for API routes (backup, container-actions, preview, webhook), OIDC authentication, registry component resolution, tag parsing, and log sanitization. Expanded UI test coverage across 38 spec files with improved Vuetify stub fidelity (v-tooltip activator slot, v-list-item slots, app-bar-nav-icon events).
- **Vitest coverage config** — Narrowed coverage to `.js`/`.ts` files only (excluding `.vue` SFCs) to avoid non-actionable template branch noise.
- **Prometheus counter deduplication** — Extracted shared `createCounter` factory in `app/prometheus/counter-factory.ts`, reducing boilerplate across audit, webhook, trigger, and container-actions counter modules.
- **API error handler deduplication** — Extracted shared `handleContainerActionError` helper in `app/api/helpers.ts`, consolidating duplicate catch-block logic across backup, preview, and container-actions routes.
- **Lint and code quality fixes** — Fixed biome `noPrototypeBuiltins` warning in OIDC tests, added `id` attributes to README HTML headings to resolve markdownlint MD051, and tuned qlty smell thresholds.

### Security

- **CodeQL alert fixes** — Fixed log injection vulnerabilities by sanitizing user-controlled input before logging. Removed unused variables flagged by static analysis. Added rate limiting to the on-demand scan endpoint.
- **Build provenance and SBOM attestations** — Added supply chain attestations to release workflow for verifiable build provenance.

## [1.2.0]

### Added

- **Grafana dashboard template** — Importable Grafana JSON dashboard with panels for overview stats, watcher activity, trigger execution, registry response times, and audit entries. Uses datasource templating for portable Prometheus configuration.
- **Audit log backend** — `AuditEntry` model, LokiJS-backed store with pagination and pruning, `GET /api/audit` endpoint with filtering, `dd_audit_entries_total` Prometheus counter, and automatic logging of container lifecycle events (update-available, update-applied, update-failed, rollback, preview, container-added, container-removed).
- **Font Awesome 6 migration** — Replaced all Material Design Icons (`mdi-*`) with Font Awesome 6 equivalents. Configured Vuetify FA icon set, updated all service icon getters, component templates, and 54 test files.
- **Dry-run preview API** — `POST /api/containers/:id/preview` returns what an update would do (current/new image, update kind, running state, networks) without performing it.
- **Pre-update image backup and rollback** — LokiJS-backed backup store records container image state before each Docker trigger update. `GET /api/backups`, `GET /api/:id/backups`, and `POST /api/:id/rollback` endpoints. Configurable retention via `DD_TRIGGER_DOCKER_{name}_BACKUP_COUNT` (default 3).
- **Frontend wiring** — Preview dialog with loading/error/success states wired to dry-run API. Full audit log table with filtering, pagination, and responsive column hiding replacing the MonitoringHistory placeholder. Recent Activity dashboard card showing latest 5 audit entries.
- **Container action bar refactor** — Replaced 3-column text button layout with compact icon-button toolbar and tooltips (desktop) or overflow menu (mobile).
- **Dashboard second row** — Added Recent Activity and stats cards as a second row on the dashboard.
- **UI modernization** — Consistent `pa-4` padding, outlined/rounded cards, tonal chips, styled empty states, and Font Awesome icons across all views and components.
- **Container actions (start/stop/restart)** — New API endpoints and UI buttons to start, stop, and restart Docker containers directly from the dashboard. Gated by `DD_SERVER_FEATURE_CONTAINERACTIONS` (default: enabled). Includes audit logging, Prometheus counter (`dd_container_actions_total`), desktop toolbar buttons with disabled-state awareness, and mobile overflow menu integration.
- **Webhook API for on-demand triggers** — Token-authenticated HTTP endpoints (`POST /api/webhook/watch`, `/watch/:name`, `/update/:name`) for CI/CD integration. Gated by `DD_SERVER_WEBHOOK_ENABLED` and `DD_SERVER_WEBHOOK_TOKEN`. Includes rate limiting (30 req/15min), audit logging, Prometheus counter (`dd_webhook_total`), and a configuration info panel on the Server settings page.
- **Container grouping / stack views** — New `GET /api/containers/groups` endpoint returns containers grouped by stack. Supports explicit group assignment via `dd.group` / `wud.group` labels with automatic fallback to `com.docker.compose.project`. Collapsible `ContainerGroup` component with group header showing name, container count, and update badges. "Smart group" filter option for automatic stack detection (`dd.group` > `wud.group` > compose project). "Update all in group" action to batch-update all containers in a group.
- **Graceful self-update UI** — Self-update detection when drydock updates its own container. Server-Sent Events (SSE) endpoint at `/api/events/ui` for real-time browser push. Full-screen DVD-style bouncing whale logo overlay during self-updates with smooth phase transitions (updating, restarting, reconnecting, ready). Automatic health polling and page reload after restart.
- **Lifecycle hooks (pre/post-update commands)** — Execute shell commands before and after container updates via `dd.hook.pre` and `dd.hook.post` labels. Pre-hook failures abort the update by default (`dd.hook.pre.abort=true`). Configurable timeout via `dd.hook.timeout` (default 60s). Environment variables exposed: `DD_CONTAINER_NAME`, `DD_IMAGE_NAME`, `DD_TAG_OLD`, `DD_TAG_NEW`, etc. Includes audit logging for hook success/failure and UI display in ContainerDetail panel.
- **Automatic rollback on health check failure** — Monitors container health after updates and automatically rolls back to the previous image if the container becomes unhealthy. Configured via `dd.rollback.auto=true`, `dd.rollback.window` (default 300s), and `dd.rollback.interval` (default 10s). Requires Docker HEALTHCHECK on the container. Uses existing backup store for rollback images. Includes audit logging and UI display in ContainerDetail panel.
- **selfhst/icons as primary icon CDN** — Switched to selfhst/icons as the primary icon CDN with homarr-labs as fallback, improving icon availability and coverage.

### Fixed

- **Navigation drawer not visible** — Used computed model for permanent/temporary modes; passing `model-value=undefined` caused Vuetify to treat the drawer as closed.
- **Dark theme missing colors** — Added `info`, `success`, and `warning` color definitions to the dark theme.
- **ContainerPreview updateKind display** — Fixed structured `updateKind` object rendering with semver-diff color coding.
- **Invalid `text-body-3` CSS class** — Replaced with valid `text-body-2` in ConfigurationItem and TriggerDetail.
- **404 catch-all route** — Added catch-all redirect to home for unknown routes.
- **False downgrade suggestion for multi-segment tags** — Fixed semver parsing/comparison for numeric tags like `25.04.2.1.1` so newer major tags are no longer suggested as downgrades. ([#47](https://github.com/CodesWhat/drydock/issues/47))
- **Configured path hardening for filesystem reads** — Added validated path resolution helpers and applied them to store paths, watcher TLS files, and MQTT TLS files before filesystem access.

### Changed

- **Audit event wiring** — Wired audit log entries and Prometheus counter increments for rollback, preview, container-added, container-removed, update-applied, and update-failed events. Registered `ContainerUpdateFailed` event with try/catch in Docker trigger.
- **Test updates** — 20+ test files updated for v1.2.0 icon changes, CSS selectors, HomeView data model, theme toggle relocation, and audit module wiring. Removed obsolete specs.
- **Updated doc icon examples** — Switched icon examples to prefer `hl:` and `si:` prefixes over deprecated `mdi:`.
- **Code quality tooling consolidation** — Replaced Codacy + SonarCloud with Qlty + Snyk. Rewrote `lefthook.yml` pre-push hooks to run `qlty check`, `snyk test`, `snyk code test` (informational), builds, and tests. Added `scripts/snyk-code-gate.sh` wrapper.
- **Biome formatting** — Applied `biome format` across entire codebase for consistent code style.
- **README badges** — Replaced Codacy/SonarCloud badges with CI status, Qlty maintainability, and Snyk badges.
- **ConfigurationItem redesign** — Icon moved to the left with name as prominent text and type as subtitle, replacing the old badge/chip pattern across all configuration pages.
- **TriggerDetail redesign** — Same modern layout treatment as ConfigurationItem (icon left, name prominent, type subtitle).
- **Registry page brand colors** — Added brand-colored icon backgrounds for each registry provider (Docker blue, GitHub purple, AWS orange, Google blue, etc.) via `getRegistryProviderColor()` helper and new `iconColor` prop on ConfigurationItem.
- **Consistent card styling** — Unified `variant="outlined" rounded="lg"` across ContainerItem, ContainerGroup, ContainerTrigger, and WebhookInfo cards for a cohesive look.
- **Home page severity badges removed** — Removed redundant MAJOR/MINOR severity badges from the container updates list; version chip color already indicates severity.
- **History page filter bar** — Removed redundant "Update History" heading (already in app bar) and added a collapsible filter bar with active filter chips.
- **Logs page spacing** — Fixed spacing between the config item and logs card.
- **Self-update overlay responsive** — Mobile-responsive self-update overlay uses static top-center positioning with fade-in animation on small screens instead of DVD bounce.
- **QA compose enhancements** — Added HTTP trigger, basic auth, and webhook configuration to `test/qa-compose.yml` for integration testing.
- **Login page redesign** — Redesigned login page with new font, icon colors, and layout polish.
- **Docker Hub and Quay.io multi-registry publishing** — Container images now published to Docker Hub and Quay.io alongside GHCR for broader registry availability.
- **Mobile responsive dashboard** — Per-type colored update badges (major=red, minor=warning, patch=success, digest=info) and icon-only tabs on mobile viewports.
- **Dark mode app bar logo inversion** — App bar logo now inverts correctly in dark mode for improved visibility.
- **History page mobile improvements** — Shorter timestamps, hidden status column, and truncated container names on mobile viewports.
- **Container filter mobile labels** — Short labels ("Updates", "Time") on mobile breakpoint for compact filter display.
- **Biome and Qlty config alignment** — Aligned Biome and Qlty configurations for consistent code quality enforcement.

### Security

- **RE2 regex engine** — Replaced native `RegExp` with Google's RE2 (`re2` npm package) for all user-supplied regex patterns (includeTags, excludeTags, transformTags). RE2 uses a linear-time matching algorithm that is inherently immune to ReDoS catastrophic backtracking.
- **Docs dependency vulnerability fixes** — Fixed 9 CVEs in docs/ transitive dependencies via npm overrides (dompurify 2→3, marked 1→4, got 9→11).

### Removed

- **Dead code removal** — Deleted unused `AppFooter` and `ConfigurationStateView` components, dead computed props (`filteredUpdates`, `upToDateCount`), duplicate `isTriggering` reset, dead `mdi:` prefix replacement in IconRenderer, dead `container-deleted` listener, and Maintenance Windows placeholder.
- **Removed `@mdi/font` dependency** — Dropped unused Material Design Icons package.
- **Removed Codacy and SonarCloud** — Replaced with Qlty (local code quality) and Snyk (dependency + SAST scanning) for a unified local-first quality gate.
- **Removed stale tracking docs** — Deleted `SONARQUBE-ISSUES.md`, `docs/sonar-smells-tracking.md`, and `docs/codacy-high-findings-tracking.md`.

### Documentation

- **Popular imgset presets** — Added a curated preset guide at `docs/configuration/watchers/popular-imgsets.md` and linked it from watcher docs.

## [1.1.3]

### Fixed

- **ERR_ERL_PERMISSIVE_TRUST_PROXY on startup** — Express `trust proxy` was hard-coded to `true`, which triggers a validation error in `express-rate-limit` v8+ when the default key generator infers client IP from `X-Forwarded-For`. Replaced with a configurable `DD_SERVER_TRUSTPROXY` env var (default: `false`). Set to `1` (hop count) when behind a single reverse proxy, or a specific IP/CIDR for tighter control. ([#43](https://github.com/CodesWhat/drydock/issues/43))

---

## [1.1.2]

### Fixed

- **Misleading docker-compose file error messages** — When a compose file had a permission error (EACCES), the log incorrectly reported "does not exist" instead of "permission denied". Now distinguishes between missing files and permission issues with actionable guidance. ([#42](https://github.com/CodesWhat/drydock/issues/42))
- **Agent watcher registration fails on startup** — Agent component path resolved outside the runtime root (`../agent/components` instead of `agent/components`), causing "Unknown watcher provider: 'docker'" errors and preventing agent watchers/triggers from registering. ([#42](https://github.com/CodesWhat/drydock/issues/42))

### Changed

- **Debug logging for component registration** — Added debug-level logging showing resolved module paths during component registration and agent component registration attempts, making path resolution issues easier to diagnose.

---

## [1.1.1] - 2026-02-11

### Fixed

- **Read-only Docker socket support** — Drydock's privilege drop prevented non-root users from connecting to `:ro` socket mounts. Added `DD_RUN_AS_ROOT=true` env var to skip the drop, improved EACCES error messages with actionable guidance, and documented socket proxy as the recommended secure alternative. ([#38](https://github.com/CodesWhat/drydock/issues/38))
- **Prometheus container gauge crash with agent containers** — The container gauge used a blacklist filter that let unknown properties (like `agent`) slip through and crash prom-client. Switched to a whitelist of known label names so unknown properties are silently ignored. ([#39](https://github.com/CodesWhat/drydock/issues/39))
- **Snackbar toast transparency** — Used `flat` variant for solid background on toast notifications.
- **Container filter layout broken on narrow viewports** — Filter columns rendered text vertically when the nav drawer was open because all 8 `v-col` elements had no width constraints. Added responsive breakpoints (`cols`/`sm`/`md`) so filters wrap properly across screen sizes. ([#40](https://github.com/CodesWhat/drydock/issues/40))

## [1.1.0] - 2026-02-10

### Added

- **Application log viewer** — New Configuration > Logs page with a terminal-style viewer for drydock's own runtime logs (startup, polling, registry checks, trigger events, errors). Backed by an in-memory ring buffer (last 1,000 entries) exposed via `GET /api/log/entries`. Supports level filtering (debug/info/warn/error), configurable tail count (50/100/500/1,000), color-coded output, and auto-scroll to newest entries. An info tooltip shows the configured server log level.
- **Agent log source selector** — When agents are configured, a "Source" dropdown appears in the log viewer to switch between the controller's own logs and any connected agent's logs. Disconnected agents are shown but disabled. Agent logs are proxied via `GET /api/agents/:name/log/entries`.
- **Container log viewer** — New "Logs" tab in the container detail expansion panel to view container stdout/stderr output directly in the UI with tail control and refresh.

## [1.0.2] - 2026-02-10

### Fixed

- **Registry and trigger crashes in agent mode** — `getSummaryTags()` and `getTriggerCounter()` also return `undefined` in agent mode. Added optional chaining to all remaining Prometheus call sites so agent mode doesn't crash when processing containers or firing triggers. (Fixes #33)

## [1.0.1] - 2026-02-10

### Fixed

- **Prometheus gauge crash in agent mode** — `getWatchContainerGauge()` returns `undefined` in agent mode since Prometheus is not initialized. Added optional chaining so the `.set()` call is safely skipped. This was the root cause of containers not being discovered in agent mode. (Fixes #23, #31)

### Changed

- **su-exec privilege dropping** — Entrypoint detects the docker socket GID and drops from root to the `node` user via `su-exec` when possible. Stays root only for GID 0 sockets (Docker Desktop / OrbStack). (Refs #25)
- **tini init system** — Added `tini` as PID 1 for proper signal forwarding to the Node process.
- **Graceful shutdown** — `SIGINT`/`SIGTERM` handlers now call `process.exit()` after cleanup so the container actually stops.

## [1.0.0] - 2026-02-10

First semver release. Drydock adopts semantic versioning starting with this release, replacing the previous CalVer (YYYY.MM.PATCH) scheme.

### Security

- **ReDoS prevention** — Replaced vulnerable regexes in trigger template evaluation (`Trigger.ts`) with linear-time string parsing (`parseMethodCall`, `isValidPropertyPath`). Added `MAX_PATTERN_LENGTH` guards in tag transform (`tag/index.ts`) and Docker watcher (`Docker.ts`) to reject oversized user-supplied regex patterns.
- **XSS prevention** — Added `escapeHtml()` sanitizer to Telegram trigger `bold()` method, preventing HTML injection via container names or tag values.
- **Workflow hardening** — Set top-level `permissions: read-all` in `release.yml` and `codeql.yml`. Pinned all CodeQL action refs to commit hashes. Added CodeQL config to exclude `js/clear-text-logging` false positives.
- **CVE-2026-24001** — Updated `diff` dependency in e2e tests (4.0.2 → 4.0.4).

### Changed

- **+285 UI tests** — 15 new spec files and 7 expanded existing specs covering configuration views, container components, trigger detail, services, router, and app shell. UI test count: 163 → 285.
- **+59 app tests** — New edge-case tests for ReDoS guard branches, `parseMethodCall` parsing, and Docker watcher label resolution. App test count: 1,254 → 1,313.
- **Complexity refactors** — Extracted helpers from high-complexity functions: `parseTriggerList`/`applyPolicyAction` (`container.ts`), `resolveLabelsFromContainer`/`mergeConfigWithImgset` (`Docker.ts`).
- **Biome lint fixes** — `import type` corrections and unused variable cleanup across 17 files.
- **Fixed doc links** — Corrected broken fragment links in `docs/_coverpage.md`.

### Removed

- **Removed legacy `vue.config.js`** — Dead Vue CLI config file; project uses Vite.

## [2026.2.3] - 2026-02-10

### Fixed

- **NTFY trigger auth 401** — Bearer token auth used unsupported `axios.auth.bearer` property; now sends `Authorization: Bearer <token>` header. Basic auth property names corrected to `username`/`password`. (#27)
- **Agent mode missing /health** — Added unauthenticated `/health` endpoint to the agent server, mounted before the auth middleware so Docker healthchecks work without the agent secret. (#27)

### Changed

- **Lefthook pre-push hooks** — Added `lefthook.yml` with pre-push checks (lint + build + test).
- **Removed startup warning** — Removed "Known Issue" notice from README now that container startup issues are resolved.

## [2026.2.2] - 2026-02-10

### Security

- **Cosign keyless signing** — Container image releases are now signed with Sigstore cosign keyless signing for supply chain integrity.
- **Least-privilege workflow permissions** — Replaced overly broad `read-all` with minimum specific permissions across all CI/CD workflows.
- **CodeQL and Scorecard fixes** — Resolved all high-severity CodeQL and OpenSSF Scorecard security alerts.
- **Pinned CI actions** — All CI action references pinned to commit hashes with Dockerfile base image digest.

### Added

- **Auto-dismiss notifications after container update** — New `resolvenotifications` option for triggers (default: `false`). When enabled, notification triggers automatically delete the sent message after the Docker trigger successfully updates the container. Implemented for Gotify via its `deleteMessage` API. Other providers (Slack, Discord, ntfy) can add support by overriding the new `dismiss()` method on the base Trigger class. New `containerUpdateApplied` event emitted by the Docker trigger on successful update.

### Fixed

- **Agent mode Prometheus crash** — Guard `getWatchContainerGauge().set()` against undefined in Agent mode where Prometheus is not initialized, fixing "Cannot read properties of undefined (reading 'set')" crash (#23)
- **Sanitize version logging** — Sanitize version strings from env vars before logging to resolve CodeQL clear-text-logging alerts in `index.ts` and `store/migrate.ts`
- **Broken event test assertion** — Fix `expect()` without matcher in event test

### Changed

- **97% test coverage** — Boosted from 76% to 97% with 449 new tests (1,254 total across 95 test files).
- **Fuzz testing** — Added property-based fuzz tests with fast-check for Docker image name parsing.
- **Static analysis fixes** — Optional chaining, `String#replaceAll()`, `readonly` modifiers, `Number.NaN`, concise regex syntax, removed unused imports, moved functions to outer scope.
- **Reduced code duplication** — Refactored duplicated code in registries, triggers, and store test files flagged by SonarCloud.
- **Pino logging** — Replaced bunyan with pino to eliminate vulnerable transitive dependencies. Added pino-pretty for human-readable log output.
- **Renamed wud to drydock** — Project references updated from upstream naming across Dockerfile, entrypoint, package files, scripts, and test fixtures.
- **CONTRIBUTING.md** — Added contributor guidelines.
- **OpenSSF Best Practices badge** — Added to README.
- **SonarCloud integration** — Added project configuration.
- **Multi-arch container images** — Docker images now built for both `linux/amd64` and `linux/arm64` architectures, published to GHCR.
- **Lefthook pre-push hooks** — Added lefthook config with pre-push checks (lint + build + test) and `npm run check` convenience script.
- **CodeQL query exclusion** — Exclude `js/clear-text-logging` query (false positives on DD_VERSION env var).

## [2026.1.0]

### Added

- **Agent mode** — Distributed monitoring with remote agent architecture. Agent components, SSE-based communication, dedicated API routes.
- **OIDC token lifecycle** — Remote watcher HTTPS auth with `Basic` + `Bearer` token support. TLS/mTLS compatibility for `DD_WATCHER_{name}_HOST`.
- **OIDC device-flow (Phase 2)** — RFC 8628 Device Authorization Grant for headless remote watcher auth. Auto-detection, polling with backoff, and refresh token rotation.
- **Per-image config presets** — `imgset` defaults for per-image configuration. Added `watchDigest` and `inspectTagPath` imgset properties.
- **Hybrid triggers** — Trigger group defaults (`DD_TRIGGER_{name}_THRESHOLD`) shared across providers. Name-only include/exclude for multi-provider trigger management.
- **Container update policy** — Skip/snooze specific update versions. Per-container policy stored in DB, exposed via API and UI.
- **Metrics auth toggle** — `DD_SERVER_METRICS_AUTH` env var to disable auth on `/metrics` endpoint.
- **Trigger thresholds** — Digest and no-digest thresholds for triggers.
- **NTFY provider-level threshold** — Provider-level threshold support for ntfy trigger.
- **Docker pull progress logging** — Rate-limited pull progress output during docker-compose updates.
- **Registry lookup image override** — `lookupImage` field on registry config to override the image used for tag lookups.
- **Docker inspect tag path** — Support custom tag path in Docker inspect output.
- **Anonymous LSCR and TrueForge registries** — Allow anonymous access to LSCR (LinuxServer) and Quay-backed TrueForge.
- **DHI registry** — New `dhi.io` registry provider with matcher, auth flow, and docs.
- **Custom URL icons** — Support URL-based icons via `dd.display.icon` label.
- **Version skip** — Skip specific versions in the UI.
- **Log viewer** — In-app container log viewer. View Docker container stdout/stderr output directly in the UI via a new "Logs" tab on each container. Supports configurable tail line count (50/100/500), manual refresh, and Docker stream demultiplexing. Works for both local and remote agent containers.
- **Semver tag recovery** — Recover include-filter mismatched semver tags from watchers. Extended to advise best semver tag when current tag is non-semver (e.g., `latest`).
- **Dashboard update chips** — Replaced verbose update status text with compact colored chips: green "up to date" or warning "N update(s)" (clickable).

### Fixed

- **eval() code injection** — Replaced `eval()` in trigger template rendering with safe expression evaluator supporting property paths, method allowlist, ternaries, and string concatenation.
- **Digest-only update prune crash** — Docker trigger prune logic now correctly excludes current image during digest-only updates and handles post-prune errors gracefully.
- **Swarm deploy-label debug logging** — Added warn-level logging when Swarm service inspect fails, and debug logging showing which label sources contain `dd.*` labels.
- **OIDC session state races** — Serialized redirect session checks, multiple pending callback states per session.
- **semverDiff undefined** — Normalized `semverDiff` for non-tag (digest-only/created-date-only) updates.
- **Docker event stream crash** — Buffered and parsed split Docker event stream payloads.
- **Multi-network container recreate** — Reconnects additional networks after container recreation.
- **Remote watcher delayed first scan** — `watchatstart` now checks watcher-local store for new remote watchers.
- **docker-compose post_start hooks** — Hooks now execute after updates.
- **docker-compose image-only triggers** — Only trigger on compose services with actual image changes.
- **docker-compose imageless services** — Skip compose services without an `image` field.
- **docker-compose implicit latest tag** — Normalize `image: nginx` to `image: nginx:latest` so compose triggers don't treat implicit latest as a version mismatch.
- **Express 5 wildcard routes** — Named wildcard route params for express 5 compatibility.
- **Semver filtering** — Fixed semver part filtering and prefix handling.
- **SMTP TLS_VERIFY inverted** — `rejectUnauthorized` was inverted; `TLS_VERIFY=false` now correctly allows self-signed certificates.
- **HA MQTT deprecated object_id** — Replaced `object_id` with `default_entity_id` for Home Assistant 2025.10+ compatibility.
- **Open redirect on authenticated pages** — Validate `next` query parameter to only allow internal routes.
- **Trigger test updateKind crash** — Test-button triggers no longer crash with "Cannot read properties of undefined (reading 'updateKind')" on unvalidated containers.
- **Docker rename event not captured** — Added `rename` to Docker event listener so container name updates are captured after compose recreates.
- **UI duplicate drawer logo** — Removed duplicate logo in navigation drawer.

### Changed

- **TypeScript migration (app)** — Entire backend converted from JavaScript to TypeScript with ES Modules (`NodeNext`). 232 `.ts` files added/renamed, all `.js` source files removed.
- **TypeScript migration (UI)** — Vue 3 frontend migrated from JS to TS. 29 `.vue` files updated, component props/emits typed.
- **Jest → Vitest (app)** — All 64 app test files (664 tests) migrated from Jest to Vitest. Test runner unified across app and UI.
- **Jest → Vitest (UI)** — UI unit tests migrated from Jest to Vitest with improved coverage.
- **Vitest 4 + modern deps** — Upgraded vitest 3→4, uuid 11→13, flat 5→6, snake-case 3→4. Fixed vitest 4 mock constructor breaking change.
- **ESM baseline** — Cut over to `NodeNext` module resolution. Removed Babel, added `tsconfig.json`.
- **Biome linter** — Replaced ESLint with Biome for formatting and linting.
- **CI cleanup** — Removed Code Climate config, renamed Travis config to `ci.config.yml`.

### Dependencies

| Package | Upstream (8.1.1) | drydock |
| --- | --- | --- |
| vitest | 3.x (Jest) | 4.x |
| uuid | 9.x | 13.x |
| flat | 5.x | 6.x |
| snake-case | 3.x | 4.x |
| express | 4.x | 5.x |
| typescript | — | 5.9 |
| biome | — | 2.3 |

> **Stats:** 392 files changed, +25,725 insertions, -25,995 deletions, 872 total tests (709 app + 163 UI).

## Upstream Backports

The following changes from `upstream/main` (post-fork) have been ported to drydock:

| Description | Status |
| --- | --- |
| Add Codeberg to default registries | Ported (new TS provider) |
| Increase `maxAliasCount` in YAML parsing | Ported |
| Fix authentication for private ECR registry (async `getAuthPull`) | Ported across all registries |
| Prometheus: add `DD_PROMETHEUS_ENABLED` config | Ported |
| Fix Authelia OIDC docs (field names) | Ported |
| Buffer Docker event stream before JSON parse | Already fixed independently |
| SMTP trigger: allow display name in from address ([#908](https://github.com/getwud/wud/pull/908)) | Ported |

Remaining upstream-only changes (not ported — not applicable to drydock):

| Description | Reason |
| --- | --- |
| Fix e2e tests (x2) | JS-based, drydock tests are TS |
| Fix prettier | drydock uses Biome |
| Fix codeberg tests | Covered by drydock's own tests |
| Update changelog | Upstream-specific |

[Unreleased]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.14...HEAD
[1.5.0-rc.14]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.13...v1.5.0-rc.14
[1.5.0-rc.13]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.12...v1.5.0-rc.13
[1.5.0-rc.12]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.11...v1.5.0-rc.12
[1.5.0-rc.11]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.10...v1.5.0-rc.11
[1.5.0-rc.10]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.9...v1.5.0-rc.10
[1.5.0-rc.9]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.8...v1.5.0-rc.9
[1.5.0-rc.8]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.7...v1.5.0-rc.8
[1.5.0-rc.7]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.6...v1.5.0-rc.7
[1.5.0-rc.6]: https://github.com/CodesWhat/drydock/compare/v1.5.0-rc.5...v1.5.0-rc.6
[1.5.0-rc.5]: https://github.com/CodesWhat/drydock/compare/v1.5.0...v1.5.0-rc.5
[1.5.0]: https://github.com/CodesWhat/drydock/compare/v1.4.5...v1.5.0
[1.4.5]: https://github.com/CodesWhat/drydock/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/CodesWhat/drydock/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/CodesWhat/drydock/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/CodesWhat/drydock/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/CodesWhat/drydock/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/CodesWhat/drydock/compare/v1.3.9...v1.4.0
[1.3.9]: https://github.com/CodesWhat/drydock/compare/v1.3.8...v1.3.9
[1.3.8]: https://github.com/CodesWhat/drydock/compare/v1.3.7...v1.3.8
[1.3.7]: https://github.com/CodesWhat/drydock/compare/v1.3.6...v1.3.7
[1.3.6]: https://github.com/CodesWhat/drydock/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/CodesWhat/drydock/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/CodesWhat/drydock/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/CodesWhat/drydock/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/CodesWhat/drydock/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/CodesWhat/drydock/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/CodesWhat/drydock/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/CodesWhat/drydock/compare/1.1.3...v1.2.0
[1.1.3]: https://github.com/CodesWhat/drydock/compare/1.1.2...1.1.3
[1.1.2]: https://github.com/CodesWhat/drydock/compare/v1.1.1...1.1.2
[1.1.1]: https://github.com/CodesWhat/drydock/compare/v1.1.0...1.1.1
[1.1.0]: https://github.com/CodesWhat/drydock/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/CodesWhat/drydock/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/CodesWhat/drydock/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/CodesWhat/drydock/releases/tag/v1.0.0
[2026.2.3]: https://github.com/CodesWhat/drydock/compare/2026.2.2...2026.2.3
[2026.2.2]: https://github.com/CodesWhat/drydock/compare/2026.1.0...2026.2.2
[2026.1.0]: https://github.com/CodesWhat/drydock/releases/tag/2026.1.0
