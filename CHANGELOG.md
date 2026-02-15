# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Fork point:** upstream post-8.1.1 (2025-11-27)
> **Upstream baseline:** WUD 8.1.1 + 65 merged PRs on `main` (Vue 3 migration, Alpine base image, Rocket.Chat trigger, threshold system, semver improvements, request→axios migration, and more)

## [Unreleased]

### Added

- **OCIR (Oracle Cloud Infrastructure Registry)** — New registry provider for Oracle Cloud Infrastructure Container Registry.
- **IBMCR (IBM Cloud Container Registry)** — New registry provider for IBM Cloud Container Registry with API key support.
- **Alicr (Alibaba Cloud Container Registry)** — New registry provider for Alibaba Cloud Container Registry.
- **GAR (Google Artifact Registry)** — New registry provider for Google Artifact Registry.
- **Harbor registry provider** — New registry provider for Harbor container registries.
- **JFrog Artifactory registry provider** — New registry provider for JFrog Artifactory container registries.
- **Sonatype Nexus registry provider** — New registry provider for Sonatype Nexus container registries.
- **Shared `SelfHostedBasic` base class** — Common base class for self-hosted registries (Harbor, Artifactory, Nexus) to reduce duplication.
- **Mattermost notification trigger** — New trigger provider for Mattermost webhook notifications.
- **Microsoft Teams notification trigger** — New trigger provider for Microsoft Teams notifications via Workflow webhook.
- **Matrix notification trigger** — New trigger provider for Matrix protocol notifications.
- **Google Chat notification trigger** — New trigger provider for Google Chat space webhook notifications.
- **Buy Me a Coffee funding option** — Added Buy Me a Coffee as a funding option.

### Changed

- **Funding badges moved to README footer** — Moved funding badges (Ko-fi, Buy Me a Coffee, GitHub Sponsors) from header to footer.

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
- **tar arbitrary file read/write** — Removed `tar` from dependency graph entirely by replacing native `re2` (which pulled in `node-gyp` → `tar`) with `re2-wasm`, a pure WASM drop-in. Previously affected by CVE GHSA-83g3-92jg-28cx.
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
- **Update Guard (Trivy safe-pull gate)** — Added pre-update vulnerability scanning for Docker-triggered updates. Candidate images are scanned before pull/restart, updates are blocked when vulnerabilities match configured blocking severities, and latest scan data is persisted on `container.security.scan`. Added `GET /api/containers/:id/vulnerabilities` endpoint for retrieving scan results.
- **Update Guard signature verification (cosign)** — Added optional pre-update image signature verification. When enabled, Docker-triggered updates are blocked if candidate image signatures are missing/invalid or verification fails.
- **Update Guard SBOM generation** — Added Trivy SBOM generation (`spdx-json`, `cyclonedx-json`) for candidate images with persistence in `container.security.sbom` and a new `GET /api/containers/:id/sbom` API endpoint (with `format` query support).
- **Container card security status chip** — Added a vulnerability chip on container cards showing Update Guard scan status (`safe`, `blocked`, `scan error`) with severity summary tooltip data from `container.security.scan`.
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

[Unreleased]: https://github.com/CodesWhat/drydock/compare/v1.3.3...HEAD
[1.3.3]: https://github.com/CodesWhat/drydock/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/CodesWhat/drydock/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/CodesWhat/drydock/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/CodesWhat/drydock/compare/v1.2.0...v1.3.0
[1.1.1]: https://github.com/CodesWhat/drydock/compare/v1.1.0...1.1.1
[1.1.0]: https://github.com/CodesWhat/drydock/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/CodesWhat/drydock/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/CodesWhat/drydock/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/CodesWhat/drydock/releases/tag/v1.0.0

<!-- CalVer tags (2026.x.x) were erased to avoid collisions with the new semver versioning system. -->
