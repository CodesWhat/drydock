# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Fork point:** upstream post-8.1.1 (2025-11-27)
> **Upstream baseline:** WUD 8.1.1 + 65 merged PRs on `main` (Vue 3 migration, Alpine base image, Rocket.Chat trigger, threshold system, semver improvements, request→axios migration, and more)

## [Unreleased]

### Added

- **Dual-slot security scanning** — "Scan Now" automatically scans both the current running image and the available update image when an update exists. Results are stored in separate slots (`scan`/`updateScan`) and the Security page shows a delta comparison badge (+N fixed, -N new) next to each image that has both scans.
- **`DD_LOG_BUFFER_ENABLED` toggle** — Disable the in-memory log ring buffer via `DD_LOG_BUFFER_ENABLED=false` to reduce per-log processing overhead. When disabled, `/api/log/entries` returns an empty array. Defaults to `true`.
- **Scheduled security scanning** — Set `DD_SECURITY_SCAN_CRON` to automatically scan all watched containers on a cron schedule. `DD_SECURITY_SCAN_JITTER` (default 60s) spreads load with random delay before each cycle.
- **Security scheduler shutdown on exit** — Security scan scheduler is now explicitly shut down during graceful exit, preventing orphan timers from delaying process termination.

### Changed

- **Prometheus collect() callback pattern** — Switched container gauge from interval-based polling to the Prometheus `collect()` callback, letting Prometheus control collection timing and eliminating the background 5s timer.
- **Container security API refactored** — Container security routes refactored into a dedicated module with type-safe SecurityGate integration, concurrent scan limiting (max 1), and trivy DB status-based cache invalidation.
- **DashboardView composable extraction** — Extracted 700+ line monolith into `useDashboardData`, `useDashboardComputed`, `useDashboardWidgetOrder`, and shared `dashboardTypes` for better testability and separation of concerns.
- **Event-driven connectivity polling** — AppLayout SSE connectivity monitoring now starts on disconnect and stops on reconnect instead of running a fixed interval, reducing unnecessary network requests.
- **Vulnerability loading optimized** — Vulnerability data loaded from the container list API payload (`includeVulnerabilities` flag) instead of separate per-container fetches, reducing API calls on the Security view.
- **Default log format is JSON** — Official Docker image now defaults to `DD_LOG_FORMAT=json` for structured production logs. Override with `DD_LOG_FORMAT=text` for pretty logs.

### Fixed

- **Log auto-fetch pauses in background tabs** — `useAutoFetchLogs` now stops polling when the browser tab is hidden and automatically resumes when it becomes visible again.
- **SBOM download DOM isolation** — Isolated DOM element creation and `URL.createObjectURL` references in the SBOM download composable, fixing potential memory leaks and test failures from uncleared object URLs. JSON serialization skipped when SBOM panel is hidden.

### Security

- **Mutation-only JSON body parser** — Express JSON body parsing restricted to mutation methods (POST/PUT/PATCH) only on both API and auth routers, reducing attack surface on read requests.
- **CSRF Sec-Fetch-Site validation** — CSRF middleware now rejects requests with `Sec-Fetch-Site: cross-site` header, blocking cross-site state-changing requests even when the Origin header is absent.
- **HTTPS enforcement for SameSite=none cookies** — `DD_SERVER_COOKIE_SAMESITE=none` now requires HTTPS configuration (`DD_SERVER_TLS_ENABLED=true` or `DD_SERVER_TRUSTPROXY`) and throws at startup if neither is set.
- **Remember-me endpoint requires authentication** — `/auth/remember` POST moved after `requireAuthentication` middleware, preventing unauthenticated access.
- **Env reveal rate limit tightened** — `/api/containers/:id/env` rate limit reduced from 100/min to 10/min to prevent credential enumeration. Server error responses return generic messages instead of internal details.
- **Trivy command path validation** — Trivy binary paths are validated against shell metacharacters and path traversal before execution.
- **Digest scan cache LRU eviction** — Scan result cache uses LRU eviction (max 500 entries, configurable via `DD_SECURITY_SCAN_DIGEST_CACHE_MAX_ENTRIES`) to prevent unbounded memory growth. Trivy DB status lookups are deduplicated across concurrent calls.

### Performance

- **LokiJS autosave interval set to 60 seconds** — Fixed autosave interval at 60s instead of the LokiJS default, reducing disk I/O while maintaining acceptable data durability.
- **SSE shared heartbeat interval** — Deduplicated per-client SSE heartbeat timers into a single shared interval that starts on first connection and stops when all clients disconnect.
- **LoginView exponential backoff** — Login page connectivity retry uses exponential backoff (5s doubling to 30s max) instead of fixed intervals, reducing server load during outages.

## [1.4.0] — 2026-02-28

### Added

#### Backend / Core

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
- **Runtime tool status endpoint** — `/api/server/security-tools` reports Trivy/Cosign availability for the Security view.
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

#### UI / Dashboard

- **Tailwind CSS 4 UI stack** — Complete frontend migration from Vuetify 3 to Tailwind CSS 4 with custom shared components. All 13 views rebuilt with Composition API.
- **Shared data components** — Reusable DataTable, DataCardGrid, DataListAccordion, DataFilterBar, DetailPanel, DataViewLayout, and EmptyState components used consistently across all views with table/cards/list view modes.
- **4 color themes** — Drydock (navy tones), GitHub (clean/familiar), Dracula (bold purple), and Catppuccin (warm pastels). Each with dark and light variants. Circle-reveal transition animation between themes.
- **7 icon libraries** — Phosphor Duotone (default), Phosphor, Lucide, Tabler, Heroicons, Iconoir, and Font Awesome. Switchable in Config > Appearance with icon size slider.
- **6 font families** — IBM Plex Mono (default/bundled), JetBrains Mono, Source Code Pro, Inconsolata, Commit Mono, and Comic Mono. Lazy-loaded from Google Fonts with internetless fallback.
- **Command palette** — Global Cmd/Ctrl+K search with scope filtering (`/` pages, `@` runtime, `#` containers), keyboard navigation, grouped sections, and recent history.
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

### Changed

- **Single Docker image** — Removed thin/heavy image variants; all images now bundle Trivy and Cosign.
- **Removed Vuetify dependency** — All Vuetify imports, components, and archived test files removed. Zero Vuetify references remain.
- **Fail-closed auth enforcement** — Registry bearer-token flows error on token endpoint failures instead of falling through to anonymous. HTTP trigger auth errors on unsupported types. Docker entrypoint requires explicit `DD_RUN_AS_ROOT` + `DD_ALLOW_INSECURE_ROOT` for root mode.
- **Dashboard streamlined** — Stat cards reduced from 7 to 4 (Containers, Updates, Security, Registries). Recent Activity widget removed to fit on single viewport. Background refresh prevents loading flicker on SSE events.
- **Notifications view is full rule management** — Editable notification rules (enable/disable and trigger assignments) that save directly through `/api/notifications`.

### Fixed

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

### Security

- **Removed plaintext credentials from login request body** — The Basic auth login was redundantly sending username and password in both the Authorization header and the JSON body. The backend only reads the Authorization header via Passport, so the body credentials were unnecessary exposure.
- **Server-issued SSE client identity** — Self-update ack requests validated against server-issued tokens, preventing spoofed acknowledgments.
- **Fail-closed auth across watchers, registries, and triggers** — Token exchange failures no longer fall through to anonymous access.
- **Runtime env values redacted** — Container environment variable values stripped from API responses to prevent credential leakage.

### Performance

- **Gzip response compression** — API responses compressed above configurable threshold with automatic SSE exclusion.
- **Skip connectivity polling when SSE connection is active** — Eliminates unnecessary `/auth/user` fetches every 10s during normal operation.
- **Set-based lookups replace linear scans** — Repeated array lookups converted to Set operations in core paths.

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

## [1.3.3] — 2026-02-16

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

## 1.2.0

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

## 1.1.3

### Bug Fixes

- **ERR_ERL_PERMISSIVE_TRUST_PROXY on startup** — Express `trust proxy` was hard-coded to `true`, which triggers a validation error in `express-rate-limit` v8+ when the default key generator infers client IP from `X-Forwarded-For`. Replaced with a configurable `DD_SERVER_TRUSTPROXY` env var (default: `false`). Set to `1` (hop count) when behind a single reverse proxy, or a specific IP/CIDR for tighter control. ([#43](https://github.com/CodesWhat/drydock/issues/43))

---

## 1.1.2

### Bug Fixes

- **Misleading docker-compose file error messages** — When a compose file had a permission error (EACCES), the log incorrectly reported "does not exist" instead of "permission denied". Now distinguishes between missing files and permission issues with actionable guidance. ([#42](https://github.com/CodesWhat/drydock/issues/42))
- **Agent watcher registration fails on startup** — Agent component path resolved outside the runtime root (`../agent/components` instead of `agent/components`), causing "Unknown watcher provider: 'docker'" errors and preventing agent watchers/triggers from registering. ([#42](https://github.com/CodesWhat/drydock/issues/42))

### Improvements

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

[Unreleased]: https://github.com/CodesWhat/drydock/compare/v1.4.0...HEAD
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
[1.1.1]: https://github.com/CodesWhat/drydock/compare/v1.1.0...1.1.1
[1.1.0]: https://github.com/CodesWhat/drydock/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/CodesWhat/drydock/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/CodesWhat/drydock/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/CodesWhat/drydock/releases/tag/v1.0.0
