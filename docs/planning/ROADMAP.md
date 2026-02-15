# Roadmap

Last updated: 2026-02-14

This file is the canonical planning roadmap.
Completed work has been intentionally removed.

## Current State

`feature/v1.2.0` is complete -- all CI checks passing, PR #45 open for merge.

Next release targets:

- `v1.3.0`: Security Integration (Trivy scanning, Update Guard, SBOM generation, image signing)
- `v1.4.0`: UI Stack Modernization (PrimeVue migration + Composition API)
- `v1.5.0`: Real-Time Detection + Observability (webhooks, notifications, release notes, log viewer, resource monitoring)
- `v1.6.0`: Fleet Management & Live Configuration (YAML config, parallel updates, dependency ordering, static image monitoring, UI config panels, volume browser)
- `v2.0.0`: Platform Expansion (Docker Swarm, Kubernetes)
- `v2.1.0`: Advanced Deployment Patterns (health check gates, canary deployments)
- `v2.2.0`: Container Operations (web terminal, file browser, image building)
- `v2.3.0`: Automation & Developer Experience (API keys, passkey auth, TOTP 2FA, OpenAPI docs, TypeScript actions, CLI)
- `v2.4.0`: Data Safety & Templates (scheduled backups, compose templates, secret management)
- `v3.0.0`: GitOps & Advanced Platform (git-based stack deployment, network topology, GPU monitoring, i18n)

## Prioritized Backlog

### Tier 1 -- High-value, builds on existing strengths

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Lifecycle hooks (pre/post-update) | Medium | **Shipped** (v1.2.0 -- `dd.hook.pre`, `dd.hook.post` labels) |
| Dependency-aware update ordering | Medium | **Scheduled** -- Phase 5.5 |
| Automatic rollback on failure | Medium | **Shipped** (v1.2.0 -- `dd.rollback.auto` label, image backup + health check rollback) |
| Container actions (start/stop/restart) | Small | **Shipped** (v1.2.0 -- `DD_SERVER_FEATURE_CONTAINERACTIONS`) |
| HTTP API for on-demand triggers | Small | **Shipped** (v1.2.0 -- webhook API with token auth) |

### Tier 2 -- Strategic differentiators

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Image vulnerability / CVE scanning | Medium | **Scheduled** -- Phase 2.1 |
| Update Guard | Medium | **Scheduled** -- Phase 2.4 |
| SBOM generation | Small | **Scheduled** -- Phase 2.3 |
| Tag regex include/exclude filters | Small | **Shipped** (v1.2.0 -- `dd.tag.include` / `dd.tag.exclude` with RE2) |
| Container grouping / stack views | Small-Medium | **Shipped** (v1.2.0 -- auto-group by Compose project) |
| Changelog / release notes in notifications | Medium | **Scheduled** -- Phase 4.3 |
| Notification templates | Medium | **Scheduled** -- Phase 4.2.1 |
| Real-time log viewer | Medium | **Scheduled** -- Phase 4.4 |
| Container resource monitoring | Medium | **Scheduled** -- Phase 4.5 |

### Tier 3 -- Platform expansion & operations

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Kubernetes provider | Large | **Scheduled** -- Phase 6.2 |
| Docker Swarm service provider | Medium | **Scheduled** -- Phase 6.1 |
| Watch non-running / static images | Small-Medium | **Scheduled** -- Phase 5.6 |
| Web terminal / container shell | Medium | **Scheduled** -- Phase 8.1 |
| Container file browser | Medium | **Scheduled** -- Phase 8.2 |
| Volume browser | Medium | **Scheduled** -- Phase 5.8 |
| Digest pinning advisory | Small | Backlog |

### Tier 4 -- Developer experience & automation

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| API keys (scoped, rotatable) | Medium | **Scheduled** -- Phase 9.1 |
| Passkey authentication (WebAuthn) | Medium | **Scheduled** -- Phase 9.1.1 |
| TOTP two-factor authentication | Small-Medium | **Scheduled** -- Phase 9.1.2 |
| OpenAPI / Swagger documentation | Medium | **Scheduled** -- Phase 9.2 |
| TypeScript scripting / Actions | Large | **Scheduled** -- Phase 9.3 |
| Drydock CLI | Medium | **Scheduled** -- Phase 9.4 |

### Tier 5 -- Data safety & ecosystem

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Scheduled automated backups | Medium | **Scheduled** -- Phase 10.1 |
| Compose templates library | Medium | **Scheduled** -- Phase 10.2 |
| Secret management | Large | **Scheduled** -- Phase 10.3 |
| Multiple compose file support | Medium | **Scheduled** -- Phase 10.4 |

### Tier 6 -- Long-term vision

| Feature | Complexity | Status |
| --------- | ------------ | ------- |
| Git-based stack deployment | Large | **Scheduled** -- Phase 11.1 |
| Network topology visualization | Large | **Scheduled** -- Phase 11.2 |
| GPU monitoring (NVIDIA/AMD) | Medium | **Scheduled** -- Phase 11.3 |
| Multi-language / i18n | Medium | **Scheduled** -- Phase 11.4 |
| Image building (Dockerfile editor, registry push) | Large | **Scheduled** -- Phase 8.3 |

## Phased Plan (Open Work Only)

## Phase 1: Safety & Confidence

**Goal:** Make auto-updates safer so users trust the tool in production.
**Timeline target:** v1.2.x

### 1.1 Maintenance Windows

Restrict when auto-updates can execute. Users configure allowed time windows per watcher or globally.

- `DD_WATCHER_{name}_MAINTENANCE_WINDOW` -- cron expression for allowed update windows (e.g., `0 2-6 * * *` for 2-6am)
- `DD_WATCHER_{name}_MAINTENANCE_WINDOW_TZ` -- timezone (default: UTC)
- Updates detected outside the window are queued and executed when the window opens
- UI shows "next maintenance window" countdown on dashboard

**Status:** complete

- Automated QA (2026-02-12): `app` tests pass, `ui` tests pass, `ui` production build passes; `app`/`ui` lint and `app` TypeScript build remain blocked by pre-existing repository issues outside maintenance-window changes
- Manual QA (2026-02-12): all scenarios passed via Playwright MCP against OrbStack
  - Window open: UI shows "Maintenance window open now" on Watchers card
  - Window closed: UI shows "Next maintenance window in 4h 10m" countdown; API confirms `maintenancewindowqueued=true` for queued-run behavior
  - Timezone: `0 10 * * * Asia/Tokyo` correctly resolves to 01:00 UTC; countdown displays accurately

**Effort:** Low

## Phase 2: Security Integration

**Goal:** Block vulnerable images from being deployed via auto-update.
**Timeline target:** v1.3.0

### 2.1 Trivy Vulnerability Scanning

Scan images before auto-update triggers execute. Block updates that introduce critical CVEs.

- `DD_SECURITY_SCANNER=trivy` -- scanner provider (start with Trivy, extensible)
- `DD_SECURITY_BLOCK_SEVERITY=CRITICAL,HIGH` -- block updates with these CVE severities
- `DD_SECURITY_TRIVY_SERVER` -- optional Trivy server URL (otherwise use CLI)
- Scan runs after registry detects new tag, before trigger execution
- API: `GET /api/containers/{id}/vulnerabilities` -- latest scan results
- UI: vulnerability badge on container cards (green/yellow/red shield icon)

**Effort:** Medium

### 2.2 Image Signing Verification

Verify cosign/Notary signatures before auto-updating.

- `DD_SECURITY_VERIFY_SIGNATURES=true`
- `DD_SECURITY_COSIGN_KEY` or keyless verification via Sigstore
- Block unsigned images from being deployed
- UI indicator: signed vs unsigned images

**Effort:** Medium

### 2.3 SBOM Generation

Generate Software Bill of Materials for container images using Trivy.

- Integrates with 2.1 scanner infrastructure (Trivy already supports SBOM output)
- Output formats: CycloneDX, SPDX
- API: `GET /api/containers/{id}/sbom` -- download SBOM for any monitored image
- UI: SBOM tab in container detail panel showing dependency tree
- Optional: attach SBOM to update notifications for compliance workflows

**Effort:** Small (leverages existing Trivy integration)

### 2.4 Update Guard

**Depends on:** 2.1 (Trivy scanner infrastructure)

Scan new images for vulnerabilities BEFORE replacing the running container. If the new image introduces CVEs above the configured threshold, block the update and notify.

- Integrates with 2.1 scanner infrastructure (Trivy, extensible to Grype)
- `DD_SECURITY_UPDATE_GUARD=true` -- enable Update Guard mode (default: false)
- Flow: detect new tag -> pull image -> scan -> compare CVE count/severity against running image -> allow or block
- Blocking criteria options:
  - `never` -- scan but never block (informational only)
  - `any` -- block if any vulnerability detected
  - `critical` -- block on critical severity only
  - `critical_high` -- block on critical or high severity
  - `more_than_current` -- block only if new image has MORE vulnerabilities than current- On block: notify via configured triggers with scan diff summary
- On allow: proceed with normal update flow
- Temporary re-tag of original image for rollback if update proceeds and fails health check

**Effort:** Medium

## Phase 3: UI Stack Modernization

**Goal:** Keep the existing Vue stack, but remove legacy patterns that increase maintenance cost and developer friction.
**Timeline target:** v1.4.0

### 3.1 Component Architecture Convergence

Standardize component authoring to one style and remove split logic/template files.

- Migrate `.vue` + external `.ts` pairs to single-file components using `<script setup lang="ts">`
- Eliminate new Options API usage and migrate existing high-churn views/components first
- Replace ad-hoc global event bus usage with explicit composables/store state where possible
- Add migration checklist for each converted component (props/events parity, typed emits, test updates)
- Replace Vuetify-first UI dependencies incrementally with PrimeVue equivalents, starting with highest-friction screens

#### Success criteria

- No new components use external `src="./Component.ts"` script pattern
- Home, Containers, and App shell are fully migrated with passing unit tests
- Team contribution guide updated with the canonical component pattern

### 3.2 Vite-Native Runtime and Build Cleanup

Remove Vue CLI-era runtime assumptions and align with current Vite conventions.

- Replace `process.env.BASE_URL`/`process.env.NODE_ENV` usage with `import.meta.env.*`
- Replace legacy `register-service-worker` integration with a Vite-compatible approach (or remove if not required)
- Keep route-level lazy loading, and add typed route-name constants for guards/navigation
- Document env variable conventions for UI (`VITE_*`) in docs

#### Success criteria

- No `process.env.*` usage remains in UI runtime code
- Service worker behavior is explicit, testable, and documented
- Router auth guard and redirect behavior covered by tests without warnings

### 3.3 Test and Performance Hardening

Clean up warnings and reduce bundle risk while keeping current feature behavior stable.

- Introduce a shared Vue test harness (router + component stubs/plugins) to remove unresolved component warnings
- Add bundle budget checks and track main chunk size trend in CI artifacts
- Split heavy UI modules/chunks where practical (icons/assets/views) to reduce initial load
- Add one Playwright smoke test for login -> dashboard -> containers path

#### Success criteria

- Unit tests pass without repeated router/component resolution warnings
- Production build emits no new large-chunk regressions above defined budget
- Smoke test passes in CI on every PR touching `ui/`

### 3.4 UI Personalization

User-facing appearance settings to make drydock feel at home in any setup.

- Configurable font family (default: IBM Plex Mono) via UI settings panel or env var
- Persist preference in localStorage, respect system default as fallback
- Candidate presets: IBM Plex Mono, JetBrains Mono, Fira Code, Inter, system default

#### Success criteria

- Font preference persists across sessions and applies globally
- Bundle selected fonts locally (no external CDN calls) — ship presets as optional npm packages, lazy-import on selection

## Phase 4: Real-Time Detection & Observability

**Goal:** Detect updates instantly instead of waiting for poll intervals. Add live observability into running containers.
**Timeline target:** v1.5.0

### 4.1 Registry Webhook Receiver

Accept push webhooks from registries for instant update detection.

- `DD_SERVER_WEBHOOK_ENABLED=true`
- `DD_SERVER_WEBHOOK_SECRET` -- shared secret for HMAC verification
- Endpoint: `POST /api/webhooks/registry` -- generic receiver
- Support webhook formats: Docker Hub, GHCR, Harbor, Quay, ACR, ECR EventBridge
- On webhook receive: immediately check affected containers, skip next poll for those images

**Effort:** Medium

### 4.2 Notification Channels (MS Teams, Matrix, Ntfy Improvements)

Expand notification coverage based on user demand.

- **MS Teams trigger provider** -- incoming webhook format, follows existing Slack/Discord pattern
- Matrix trigger provider
- Ntfy enhancements (topic routing, priority levels, action buttons)

**Effort:** Low per provider

### 4.2.1 Notification Templates

User-customizable notification message templates for all trigger providers.

- Go-style or Handlebars template syntax for notification message formatting
- Per-trigger template override (customize Slack format differently from Discord)
- Built-in template variables: container name, image, old tag, new tag, CVE summary, release notes
- Template preview/test in UI before saving
- Default templates that match current behavior (no breaking changes)

**Effort:** Medium

### 4.3 Release Notes in Notifications

Automatically fetch and embed release notes / changelogs in update notifications.

- Map container images to source repositories (GHCR -> GitHub repo, Docker Hub source URL metadata)
- Fetch GitHub/GitLab Releases API for new tags
- Include release notes summary in trigger notification payloads (Slack, Discord, Teams, email, etc.)
- `dd.source.repo=github.com/org/repo` label for manual mapping when auto-detection fails
- UI: show release notes in container detail panel alongside update info
- Start with GitHub Releases, expand to GitLab/Gitea/Forgejo

**Effort:** Medium

### 4.4 Real-Time Log Viewer

In-app container log streaming with search, filtering, and download.

- WebSocket-based real-time log streaming from Docker API
- ANSI color support and automatic JSON log detection/formatting
- Search and regex filtering within log output
- Filter by output type (stdout/stderr) and log level
- Split-screen mode for viewing multiple container logs simultaneously
- Log download (gzip) for offline analysis
- Pause/resume streaming with auto-scroll toggle
- No persistent log storage -- real-time viewer only (Docker's log driver handles retention)

**Effort:** Medium

### 4.5 Container Resource Monitoring

Live CPU, memory, network, and disk I/O metrics per container.

- Real-time metrics via Docker stats API with SSE streaming to UI
- Per-container resource graphs (CPU %, memory usage, network RX/TX, block I/O)
- Dashboard-level resource overview (top consumers, total usage)
- Configurable metric collection interval (default: 10s)
- Historical sparklines for recent trend (in-memory ring buffer, not persistent)
- Resource alerts: optional threshold-based notifications (e.g., CPU > 90% for 5 minutes)

**Effort:** Medium

## Phase 5: Fleet Management & Live Configuration

**Goal:** Better UX for managing many containers across many hosts, and eliminate the "edit env vars + restart" workflow for common configuration changes.
**Timeline target:** v1.6.0

### 5.1 YAML Configuration File + Config API (Foundation)

This is the foundation for all UI-writable configuration. Must ship before 5.7.

- Load `drydock.yml` at startup alongside env vars
- Precedence: env vars > config file > defaults (env vars are immutable overrides for Docker Compose deployments)
- Map to existing Joi-validated internal config schema
- Config API: `GET /api/config` (read merged config), `PUT /api/config/{section}` (write to YAML file)
- Hot-reload: file watcher on `drydock.yml` applies changes to triggers, watchers, image lists, and thresholds without container restart
- Sections that require restart (server port, TLS, auth providers) return a "restart required" flag in the API response
- Config file is mounted as a volume (e.g. `-v ./drydock.yml:/config/drydock.yml`)
- Document migration path from env vars to config file

**Effort:** Medium-Large (foundation investment)

### 5.2 Aggregated Multi-Agent Dashboard

Unified view across all agents without requiring source selection.

- Dashboard shows all containers from all agents in one list
- Filter/group by: agent, registry, update status, tag type, custom labels
- Bulk actions: "Update all" with confirmation, "Snooze all patch updates"
- Agent health overview: connected/disconnected/last-seen status bar
- Cross-environment resource grouping by custom labels

**Effort:** Medium

### 5.3 Container Groups / Labels

Organize containers into user-defined groups with cross-environment support.

- `dd.group=production` / `dd.group=staging` container labels
- UI: group-based filtering and batch operations
- Per-group policies and trigger routing
- Cross-environment label grouping (see all `production` containers across all agents)

**Effort:** Medium

### 5.4 Parallel / Concurrent Container Updates

Process updates concurrently instead of sequentially for large fleets.

- `DD_TRIGGER_CONCURRENCY=4` -- max simultaneous trigger executions (default: 1 for backward compat)
- Semaphore/pool pattern around trigger execution
- Per-trigger concurrency override: `DD_TRIGGER_{name}_CONCURRENCY`
- Progress reporting in UI for batch operations

**Effort:** Small

### 5.5 Container Dependency Ordering

Update containers in safe dependency order within a stack.

- Auto-detect `depends_on` relationships from Docker Compose files
- Manual override via `dd.depends_on=container_a,container_b` labels
- Topological sort for update execution order (databases before apps, apps before proxies)
- Cycle detection with warning
- Respect dependency order in batch and compose trigger operations

**Effort:** Medium

### 5.6 Static Image List Monitoring

Watch images that aren't tied to running containers.

- New watcher provider type: `DD_WATCHER_{name}_PROVIDER=file`
- `DD_WATCHER_{name}_FILE=/config/images.yml` -- YAML list of images to monitor
- Synthetic container representation for downstream compatibility
- Use cases: pre-pull staging images, CI pipeline base images, Dockerfile FROM monitoring
- Supports all existing tag filtering, registry auth, and trigger routing

**Effort:** Medium

### 5.7 Live UI Configuration Panels

**Depends on:** 5.1 (YAML config + Config API)

Turn the existing read-only Configuration pages into live editors that write back to `drydock.yml`. This is the single biggest UX leap -- adding a Slack webhook becomes "click Add Trigger, fill form, save" instead of "stop container, add env var, restart."

#### UI-configurable (hot-reloadable, no restart needed)

These settings are written to `drydock.yml` via the Config API and take effect immediately:

| Setting | UI Component | Notes |
| --------- | -------------- | ------- |
| Triggers / notifications | Add/edit/delete form (webhook URL, channel, threshold) | Add a Teams or Slack channel without restarting |
| Maintenance windows | Cron schedule picker with visual calendar | Drag to select time windows, timezone dropdown |
| Per-container trigger routing | Checkbox/dropdown in container detail panel | Assign triggers and thresholds per container |
| Per-container update thresholds | Dropdown: all / major / minor / patch | Override from container detail panel |
| Container dependency ordering | Visual tree/graph editor in stack view | Drag to reorder, auto-detect from compose |
| Static image watch list | CRUD table: image, tag filter, registry | Add/remove images to monitor without labels |
| Container display names / icons | Inline edit in container list | Override `dd.display.name` / `dd.display.icon` |
| Watcher poll intervals | Slider or number input | Change poll frequency without restart |

#### Env-var / config-file only (restart required)

These settings are displayed read-only in the UI with a note that changes require a restart:

| Setting | Reason |
| --------- | -------- |
| Docker socket path / remote host connections | Security-sensitive infrastructure |
| Registry credentials (tokens, passwords) | Secrets must not round-trip through browser; use `__FILE` or env vars |
| Auth provider config (OIDC discovery URL, client secret) | Misconfiguration locks you out of the UI itself |
| TLS/HTTPS, server port, bind address | Requires listener restart |
| Agent configuration (remote agent URLs, auth) | Infrastructure-level, changed rarely |
| Concurrency limits | Operational tuning, low-frequency change |

#### Architecture

```text
UI Panel --POST--> /api/config/triggers --> validate (Joi) --> write drydock.yml --> hot-reload triggers
                                                           --> return { success: true, restart: false }

UI Panel --POST--> /api/config/server  --> validate (Joi) --> write drydock.yml --> return { success: true, restart: true }
                                                           --> UI shows "Restart required" banner
```

- All writes go through the same Joi validation used at startup
- Config API is gated by authentication (same as all other API routes)
- Audit log entry for every config change (who changed what, when)
- `drydock.yml` changes are atomic (write temp file, rename) to prevent corruption
- Secrets are never returned in `GET /api/config` responses -- masked or omitted

**Effort:** Large (but high-impact)

### 5.8 Volume Browser

Browse, inspect, and export Docker volume contents from the UI.

- Directory navigation and file listing within volumes
- File download (tar archive) and upload
- File metadata display (size, permissions, modified date)
- Read-only mode when volume is in use by a running container
- Helper container pattern for volume access (auto-cleanup)

**Effort:** Medium

## Phase 6: Platform Expansion

**Goal:** Extend beyond single-host Docker to Swarm and Kubernetes.
**Timeline target:** v2.0.0

### 6.1 Docker Swarm Native Support

Swarm-aware service discovery and update mechanism.

- New watcher provider: `DD_WATCHER_{name}_PROVIDER=swarm`
- Discover Swarm services and their image specs via Docker Swarm API
- Service-level update trigger: `docker service update --image` instead of container recreation
- Support replicated and global service modes
- Detect service labels for `dd.*` configuration (in addition to container labels)
- Multi-node awareness without needing per-node agents

**Effort:** Medium

### 6.2 Kubernetes Watcher Provider

New watcher provider alongside Docker watcher.

- `DD_WATCHER_{name}_PROVIDER=kubernetes`
- `DD_WATCHER_{name}_KUBECONFIG` -- path to kubeconfig (or in-cluster service account)
- `DD_WATCHER_{name}_NAMESPACE` -- namespace filter (default: all)
- Watch Deployments, StatefulSets, DaemonSets, CronJobs for container images
- Use K8s watch API for real-time container changes

### 6.3 Kubernetes Update Triggers

- `DD_TRIGGER_{name}_PROVIDER=kubernetes` -- patch Deployment image field
- Rolling update strategy controls (maxSurge, maxUnavailable)
- Helm upgrade trigger (`DD_TRIGGER_{name}_PROVIDER=helm`)
- Kustomize image override support

**Effort:** High

## Phase 7: Advanced Deployment Patterns

**Goal:** Enterprise-grade deployment safety.
**Timeline target:** v2.1.0
**Depends on:** Phase 6

### 7.1 Health Check Gate

Post-update health verification before declaring success.

- After update trigger: poll container health endpoint for configurable duration
- `DD_TRIGGER_{name}_HEALTHCHECK_URL` -- endpoint to check post-update
- `DD_TRIGGER_{name}_HEALTHCHECK_TIMEOUT=120` -- seconds to wait for healthy
- On failure: auto-rollback and notify

### 7.2 Canary Deployments (Kubernetes only)

Progressive traffic shifting for Kubernetes workloads.

- `DD_TRIGGER_{name}_STRATEGY=canary`
- `DD_TRIGGER_{name}_CANARY_STEPS=10,25,50,100`
- `DD_TRIGGER_{name}_CANARY_INTERVAL=300`
- Automatic rollback on error-rate spike

**Effort:** High

## Phase 8: Container Operations

**Goal:** Full container interaction capabilities -- shell, files, and image building.
**Timeline target:** v2.2.0

### 8.1 Web Terminal / Container Shell

Interactive shell access to running containers from the UI.

- WebSocket-based terminal emulator (xterm.js)
- Configurable shell selection (bash, sh, zsh, ash)
- User context options for exec sessions
- Keyboard shortcuts support
- Session timeout and idle disconnect
- Gated by authentication and container actions feature flag

**Effort:** Medium

### 8.2 Container File Browser

Browse, upload, and download files from running containers.

- Directory navigation and file listing
- File download (tar archives) and upload
- File metadata display (size, permissions, type)
- Helper container auto-cleanup for stopped containers
- Integrates with container detail panel

**Effort:** Medium

### 8.3 Image Building

Build Docker images from Dockerfiles directly in drydock.

- In-browser Dockerfile editor with syntax highlighting
- Build log streaming (real-time via Docker build API)
- Registry push after successful build
- Build cache management
- Support for build args and multi-stage builds
- Build history with status and logs

**Effort:** Large

## Phase 9: Automation & Developer Experience

**Goal:** First-class API access, automation scripting, and CLI tooling.
**Timeline target:** v2.3.0

### 9.1 API Keys

Scoped, rotatable API keys for automation and third-party integrations.

- Key generation via UI and API
- Scope control: read-only, trigger-only, full access
- Usage tracking and last-used timestamps
- Key rotation without downtime
- Rate limiting per key

**Effort:** Medium

### 9.1.1 Passkey Authentication (WebAuthn)

Modern passwordless authentication using platform authenticators.

- WebAuthn/FIDO2 registration and login flow
- Support for hardware keys (YubiKey), platform biometrics (Touch ID, Windows Hello), and mobile passkeys
- Passkey management UI (register, rename, delete)
- Works alongside existing OIDC and basic auth (additive, not replacement)
- Resident key support for username-less login

**Effort:** Medium

### 9.1.2 TOTP Two-Factor Authentication

Standard time-based one-time password 2FA for local accounts.

- QR code provisioning with authenticator app (Google Authenticator, Authy, 1Password, etc.)
- Recovery codes generated at enrollment
- Enforced or optional per account
- Works with basic auth login flow (password + TOTP code)

**Effort:** Small-Medium

### 9.2 OpenAPI / Swagger Documentation

Auto-generated interactive API documentation.

- OpenAPI 3.0 spec generated from Express routes
- Interactive Swagger UI at `/api/docs`
- Code examples for common operations
- Authentication documentation
- Versioned API schema

**Effort:** Medium

### 9.3 TypeScript Scripting / Actions

User-defined automation scripts that run inside drydock.

- In-browser TypeScript editor with drydock API bindings
- Scheduled runs (cron expressions)
- Event-driven triggers (on update detected, on container crash, etc.)
- Built-in helpers for common workflows (batch update, conditional notify, etc.)
- Execution log and history
- Sandboxed runtime with resource limits

**Effort:** Large

### 9.4 Drydock CLI

Command-line interface for managing drydock from the terminal.

- Container listing, status, and update checks
- Trigger execution and manual updates
- Configuration management
- CI/CD friendly output (JSON, table, quiet modes)
- Connects to drydock API (local or remote)
- Shell completions (bash, zsh, fish)

**Effort:** Medium

## Phase 10: Data Safety & Templates

**Goal:** Protect user data and simplify application deployment.
**Timeline target:** v2.4.0

### 10.1 Scheduled Automated Backups

Schedule automatic backups of containers, volumes, and configuration.

- Backup targets: local filesystem, Amazon S3, SFTP (SSH), Backblaze B2
- Cron-based scheduling with timezone support
- Backup scope: volumes, container configs, drydock configuration
- Retention policies (keep last N backups, expire after N days)
- Backup status dashboard with history and size tracking
- Restore workflow via UI or CLI
- Pre-backup hooks (stop container, flush DB, etc.)

**Effort:** Medium-Large

### 10.2 Compose Templates Library

Pre-built Docker Compose templates for popular self-hosted applications.

- Built-in app catalog with curated templates
- One-click deployment from template
- Community-contributed templates via Git repository
- Template customization before deployment (env vars, ports, volumes)
- Template versioning and updates
- Compatible with Portainer/Yacht template format for easy migration

**Effort:** Medium

### 10.3 Secret Management

Securely store, manage, and inject secrets into containers.

- Encrypted secret storage (AES-256-GCM at rest)
- Environment variable injection at container start
- Secret rotation with automatic container restart
- Access audit log (who accessed which secret, when)
- File-based secret mounting (Docker secrets pattern)
- Integration with external secret stores (Vault, AWS Secrets Manager) as stretch goal

**Effort:** Large

### 10.4 Multiple Compose File Support

Compose file composition for environment-specific overrides.

- Base compose file + override files (docker-compose.override.yml pattern)
- Environment-specific overrides (dev, staging, production)
- File merging preview in UI before deployment
- Support for `extends` and `include` directives
- Pairs with 5.1 YAML config foundation

**Effort:** Medium

## Phase 11: GitOps & Advanced Platform

**Goal:** Git-driven deployments, advanced visualization, hardware monitoring, and internationalization.
**Timeline target:** v3.0.0

### 11.1 Git-Based Stack Deployment

Deploy and manage Docker Compose stacks from Git repositories.

- Deploy stacks from GitHub, GitLab, Gitea, Forgejo (SSH and HTTPS)
- Webhook triggers for auto-deploy on push
- Intelligent change detection (only redeploy when compose directory changes)
- Branch selection and switching
- Encrypted credential storage for Git authentication
- Scheduled auto-sync with cron expressions
- Multiple stacks per repository with different compose paths
- `.env` file detection and application

**Effort:** Large

### 11.2 Network Topology Visualization

Visual map of container relationships, networks, and traffic flow.

- Interactive network graph showing containers, networks, and connections
- Real-time topology updates as containers start/stop
- Network troubleshooting: identify connectivity issues visually
- Filter by stack, network, or label
- Export topology as image or SVG

**Effort:** Large

### 11.3 GPU Monitoring

Monitor NVIDIA and AMD GPU usage for GPU-accelerated containers.

- GPU utilization percentage and VRAM usage
- Temperature monitoring with threshold alerts
- Multi-GPU support (per-device metrics)
- Integration with NVIDIA Container Toolkit / ROCm
- GPU metrics in container detail panel and dashboard

**Effort:** Medium

### 11.4 Multi-Language / i18n

Full internationalization support with community-contributed translations.

- Language selector in UI settings
- RTL (right-to-left) layout support
- Community translation workflow (JSON locale files in Git)
- Fallback to English for untranslated strings
- Start with top requested languages: Spanish, French, German, Portuguese, Chinese, Japanese

**Effort:** Medium

## Not Planned

| Feature | Reason |
| --------- | -------- |
| Git PR workflow | Renovate's domain; drydock is runtime monitoring, not source-dependency management |
| RBAC / multi-user roles | Enterprise feature, not our target audience; OIDC + basic auth + passkey covers access control |
| 90+ package managers | Out of scope for a container-focused product |
| Docker run to compose converter | Dockge's domain; drydock is update monitoring + container management, not compose authoring |
| CI/CD pipelines | Komodo's domain; drydock focuses on runtime management, not build pipelines |
| App store / one-click deploy catalog | CasaOS/Runtipi/Cosmos territory; compose templates (Phase 10.2) covers curated deployments |
| Nomad provider | Low demand; Kubernetes and Swarm cover primary orchestration needs |
| LDAP / Active Directory | Enterprise auth; OIDC + passkey + TOTP covers modern auth needs |
| Podman/containerd support | Reassess after Kubernetes watcher ships (Phase 6); Podman's Docker-compat API may work with minimal changes |

## Already Functional (Documentation Needed)

| Feature | Status |
| --------- | -------- |
| Self-update | The Docker trigger can already update drydock's own container. The UI has a self-update overlay with auto-reconnect. Needs documentation and explicit testing to confirm end-to-end reliability. |
