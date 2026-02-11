# Changelog — drydock

This changelog covers all changes in **drydock** since forking from [getwud/wud](https://github.com/getwud/wud) upstream.

**Fork point:** upstream post-8.1.1 (2025-11-27)
**Upstream baseline:** WUD 8.1.1 + 65 merged PRs on `main` (Vue 3 migration, Alpine base image, Rocket.Chat trigger, threshold system, semver improvements, request→axios migration, and more)

---

## 1.1.1

### Bug Fixes

- **Read-only Docker socket support** — Drydock's privilege drop prevented non-root users from connecting to `:ro` socket mounts. Added `DD_RUN_AS_ROOT=true` env var to skip the drop, improved EACCES error messages with actionable guidance, and documented socket proxy as the recommended secure alternative. ([#38](https://github.com/CodesWhat/drydock/issues/38))
- **Prometheus container gauge crash with agent containers** — The container gauge used a blacklist filter that let unknown properties (like `agent`) slip through and crash prom-client. Switched to a whitelist of known label names so unknown properties are silently ignored. ([#39](https://github.com/CodesWhat/drydock/issues/39))
- **Container filter layout broken on narrow viewports** — Filter columns rendered text vertically when the nav drawer was open because all 8 `v-col` elements had no width constraints. Added responsive breakpoints (`cols`/`sm`/`md`) so filters wrap properly across screen sizes. ([#40](https://github.com/CodesWhat/drydock/issues/40))

---

## 1.1.0

### Features

- **Application log viewer** — New Configuration > Logs page with a terminal-style viewer for drydock's own runtime logs (startup, polling, registry checks, trigger events, errors). Backed by an in-memory ring buffer (last 1,000 entries) exposed via `GET /api/log/entries`. Supports level filtering (debug/info/warn/error), configurable tail count (50/100/500/1,000), color-coded output, and auto-scroll to newest entries. An info tooltip shows the configured server log level.
- **Agent log source selector** — When agents are configured, a "Source" dropdown appears in the log viewer to switch between the controller's own logs and any connected agent's logs. Disconnected agents are shown but disabled. Agent logs are proxied via `GET /api/agents/:name/log/entries`.
- **Container log viewer** — New "Logs" tab in the container detail expansion panel to view container stdout/stderr output directly in the UI with tail control and refresh.

---

## 1.0.2

### Bug Fixes

- **Registry and trigger crashes in agent mode** — `getSummaryTags()` and `getTriggerCounter()` also return `undefined` in agent mode. Added optional chaining to all remaining Prometheus call sites so agent mode doesn't crash when processing containers or firing triggers. (Fixes #33)

---

## 1.0.1

### Bug Fixes

- **Prometheus gauge crash in agent mode** — `getWatchContainerGauge()` returns `undefined` in agent mode since Prometheus is not initialized. Added optional chaining so the `.set()` call is safely skipped. This was the root cause of containers not being discovered in agent mode. (Fixes #23, #31)

### Infrastructure

- **su-exec privilege dropping** — Entrypoint detects the docker socket GID and drops from root to the `node` user via `su-exec` when possible. Stays root only for GID 0 sockets (Docker Desktop / OrbStack). (Refs #25)
- **tini init system** — Added `tini` as PID 1 for proper signal forwarding to the Node process.
- **Graceful shutdown** — `SIGINT`/`SIGTERM` handlers now call `process.exit()` after cleanup so the container actually stops.

---

## 1.0.0

First semver release. Drydock adopts semantic versioning starting with this release, replacing the previous CalVer (YYYY.MM.PATCH) scheme.

### Security

- **ReDoS prevention** — Replaced vulnerable regexes in trigger template evaluation (`Trigger.ts`) with linear-time string parsing (`parseMethodCall`, `isValidPropertyPath`). Added `MAX_PATTERN_LENGTH` guards in tag transform (`tag/index.ts`) and Docker watcher (`Docker.ts`) to reject oversized user-supplied regex patterns.
- **XSS prevention** — Added `escapeHtml()` sanitizer to Telegram trigger `bold()` method, preventing HTML injection via container names or tag values.
- **Workflow hardening** — Set top-level `permissions: read-all` in `release.yml` and `codeql.yml`. Pinned all CodeQL action refs to commit hashes. Added CodeQL config to exclude `js/clear-text-logging` false positives.
- **CVE-2026-24001** — Updated `diff` dependency in e2e tests (4.0.2 → 4.0.4).

### Testing

- **+285 UI tests** — 15 new spec files and 7 expanded existing specs covering configuration views, container components, trigger detail, services, router, and app shell. UI test count: 163 → 285.
- **+59 app tests** — New edge-case tests for ReDoS guard branches, `parseMethodCall` parsing, and Docker watcher label resolution. App test count: 1,254 → 1,313.

### Code Quality

- **Complexity refactors** — Extracted helpers from high-complexity functions: `parseTriggerList`/`applyPolicyAction` (`container.ts`), `resolveLabelsFromContainer`/`mergeConfigWithImgset` (`Docker.ts`).
- **Biome lint fixes** — `import type` corrections and unused variable cleanup across 17 files.
- **Removed legacy `vue.config.js`** — Dead Vue CLI config file; project uses Vite.
- **Fixed doc links** — Corrected broken fragment links in `docs/_coverpage.md`.

---

## 2026.2.3

### Bug Fixes

- **NTFY trigger auth 401** — Bearer token auth used unsupported `axios.auth.bearer` property; now sends `Authorization: Bearer <token>` header. Basic auth property names corrected to `username`/`password`. (#27)
- **Agent mode missing /health** — Added unauthenticated `/health` endpoint to the agent server, mounted before the auth middleware so Docker healthchecks work without the agent secret. (#27)

### Infrastructure

- **Lefthook pre-push hooks** — Added `lefthook.yml` with pre-push checks (lint + build + test).

### Maintenance

- **Removed startup warning** — Removed "Known Issue" notice from README now that container startup issues are resolved.

---

## 2026.2.2

### Security / CI

- **Cosign keyless signing** — Container image releases are now signed with Sigstore cosign keyless signing for supply chain integrity.
- **Least-privilege workflow permissions** — Replaced overly broad `read-all` with minimum specific permissions across all CI/CD workflows.
- **CodeQL and Scorecard fixes** — Resolved all high-severity CodeQL and OpenSSF Scorecard security alerts.
- **Pinned CI actions** — All CI action references pinned to commit hashes with Dockerfile base image digest.

### Testing

- **97% test coverage** — Boosted from 76% to 97% with 449 new tests (1,254 total across 95 test files).
- **Fuzz testing** — Added property-based fuzz tests with fast-check for Docker image name parsing.

### Code Quality

- **Static analysis fixes** — Optional chaining, `String#replaceAll()`, `readonly` modifiers, `Number.NaN`, concise regex syntax, removed unused imports, moved functions to outer scope.
- **Reduced code duplication** — Refactored duplicated code in registries, triggers, and store test files flagged by SonarCloud.

### Dependencies

- **Pino logging** — Replaced bunyan with pino to eliminate vulnerable transitive dependencies. Added pino-pretty for human-readable log output.

### Maintenance

- **Renamed wud to drydock** — Project references updated from upstream naming across Dockerfile, entrypoint, package files, scripts, and test fixtures.
- **CONTRIBUTING.md** — Added contributor guidelines.
- **OpenSSF Best Practices badge** — Added to README.
- **SonarCloud integration** — Added project configuration.

### Features

- **Auto-dismiss notifications after container update** — New `resolvenotifications` option for triggers (default: `false`). When enabled, notification triggers automatically delete the sent message after the Docker trigger successfully updates the container. Implemented for Gotify via its `deleteMessage` API. Other providers (Slack, Discord, ntfy) can add support by overriding the new `dismiss()` method on the base Trigger class. New `containerUpdateApplied` event emitted by the Docker trigger on successful update.

### Bug Fixes

- **Agent mode Prometheus crash** — Guard `getWatchContainerGauge().set()` against undefined in Agent mode where Prometheus is not initialized, fixing "Cannot read properties of undefined (reading 'set')" crash (#23)
- **Sanitize version logging** — Sanitize version strings from env vars before logging to resolve CodeQL clear-text-logging alerts in `index.ts` and `store/migrate.ts`
- **Broken event test assertion** — Fix `expect()` without matcher in event test

### Infrastructure

- **Multi-arch container images** — Docker images now built for both `linux/amd64` and `linux/arm64` architectures, published to GHCR
- **Lefthook pre-push hooks** — Added lefthook config with pre-push checks (lint + build + test) and `npm run check` convenience script
- **CodeQL query exclusion** — Exclude `js/clear-text-logging` query (false positives on DD_VERSION env var)

---

## 2026.1.0 (398 files changed)

### Architecture / Tooling

- **TypeScript migration (app)** — Entire backend converted from JavaScript to TypeScript with ES Modules (`NodeNext`). 232 `.ts` files added/renamed, all `.js` source files removed.
- **TypeScript migration (UI)** — Vue 3 frontend migrated from JS to TS. 29 `.vue` files updated, component props/emits typed.
- **Jest → Vitest (app)** — All 64 app test files (664 tests) migrated from Jest to Vitest. Test runner unified across app and UI.
- **Jest → Vitest (UI)** — UI unit tests migrated from Jest to Vitest with improved coverage.
- **Vitest 4 + modern deps** — Upgraded vitest 3→4, uuid 11→13, flat 5→6, snake-case 3→4. Fixed vitest 4 mock constructor breaking change.
- **ESM baseline** — Cut over to `NodeNext` module resolution. Removed Babel, added `tsconfig.json`.
- **Biome linter** — Replaced ESLint with Biome for formatting and linting.
- **CI cleanup** — Removed Code Climate config, renamed Travis config to `ci.config.yml`.

### Features

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

### Bug Fixes

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

### Stats

| Metric | Value |
| --- | --- |
| Files changed | 392 |
| Insertions | +25,725 |
| Deletions | -25,995 |
| App tests | 709 (vitest) |
| UI tests | 163 (vitest) |
| Total tests | 872 |

---

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
