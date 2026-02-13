# Roadmap

Last updated: 2026-02-13

This file is the canonical planning roadmap.
Completed work has been intentionally removed.

## Current State

`feature/v1.2.0` is complete -- all CI checks passing, PR #45 open for merge.

Next release targets:

- `v1.3.0`: Security Integration (Trivy scanning, image signing)
- `v1.4.0`: UI Stack Modernization (PrimeVue migration + Composition API)
- `v1.5.0`: Real-Time Detection + Notifications (webhooks, MS Teams, Matrix, release notes)
- `v1.6.0`: Fleet Management & Live Configuration (YAML config foundation, parallel updates, dependency ordering, static image monitoring, UI config panels)
- `v2.0.0`: Platform Expansion (Docker Swarm, Kubernetes)

## Prioritized Backlog (Competitive Analysis)

Based on analysis of Watchtower, Diun, Dozzle, Portainer, Yacht, Shepherd, Renovate, Keel, and Flux CD.

### Tier 1 -- High-value, builds on existing strengths

| Feature | Competitor(s) | Complexity | Status |
| --------- | --------------- | ------------ | ------- |
| Lifecycle hooks (pre/post-update) | Watchtower | Medium | **Shipped** (v1.2.0 -- `dd.hook.pre`, `dd.hook.post` labels) |
| Dependency-aware update ordering | Watchtower | Medium | **Scheduled** -- Phase 5.5 |
| Automatic rollback on failure | Shepherd | Medium | **Shipped** (v1.2.0 -- `dd.rollback.auto` label, image backup + health check rollback) |
| Container actions (start/stop/restart) | Dozzle, Portainer | Small | **Shipped** (v1.2.0 -- `DD_SERVER_FEATURE_CONTAINERACTIONS`) |
| HTTP API for on-demand triggers | Watchtower | Small | **Shipped** (v1.2.0 -- webhook API with token auth) |

### Tier 2 -- Strategic differentiators

| Feature | Competitor(s) | Complexity | Status |
| --------- | --------------- | ------------ | ------- |
| Image vulnerability / CVE scanning | Renovate, Portainer | Medium | **Scheduled** -- Phase 2.1 |
| Tag regex include/exclude filters | Diun | Small | **Shipped** (v1.2.0 -- `dd.tag.include` / `dd.tag.exclude` with RE2) |
| Container grouping / stack views | Dozzle | Small-Medium | **Shipped** (v1.2.0 -- auto-group by Compose project) |
| Changelog / release notes in notifications | Renovate | Medium | **Scheduled** -- Phase 4.3 |

### Tier 3 -- Platform expansion

| Feature | Competitor(s) | Complexity | Status |
| --------- | --------------- | ------------ | ------- |
| Kubernetes provider | Diun, Portainer, Dozzle | Large | **Scheduled** -- Phase 6.2 |
| Docker Swarm service provider | Shepherd, Diun | Medium | **Scheduled** -- Phase 6.1 |
| Watch non-running / static images | Diun | Small-Medium | **Scheduled** -- Phase 5.6 |
| Web terminal / container shell | Dozzle, Portainer | Medium | Backlog |
| Digest pinning advisory | Renovate | Small | Backlog |

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

**Competitors with this:** GKE, Azure Container Apps, Portainer  
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

**Competitors with this:** Renovate (Snyk integration), Flux CD (admission controllers)  
**Effort:** Medium

### 2.2 Image Signing Verification

Verify cosign/Notary signatures before auto-updating.

- `DD_SECURITY_VERIFY_SIGNATURES=true`
- `DD_SECURITY_COSIGN_KEY` or keyless verification via Sigstore
- Block unsigned images from being deployed
- UI indicator: signed vs unsigned images

**Competitors with this:** Flux CD (cosign verification), Keel (admission policies)  
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

## Phase 4: Real-Time Detection

**Goal:** Detect updates instantly instead of waiting for poll intervals.
**Timeline target:** v1.5.0

### 4.1 Registry Webhook Receiver

Accept push webhooks from registries for instant update detection.

- `DD_SERVER_WEBHOOK_ENABLED=true`
- `DD_SERVER_WEBHOOK_SECRET` -- shared secret for HMAC verification
- Endpoint: `POST /api/webhooks/registry` -- generic receiver
- Support webhook formats: Docker Hub, GHCR, Harbor, Quay, ACR, ECR EventBridge
- On webhook receive: immediately check affected containers, skip next poll for those images

**Competitors with this:** Keel (DockerHub, Quay, Azure, GCR webhooks)  
**Effort:** Medium

### 4.2 Notification Channels (MS Teams, Matrix, Ntfy Improvements)

Expand notification coverage based on user demand.

- **MS Teams trigger provider** -- incoming webhook format, follows existing Slack/Discord pattern
- Matrix trigger provider
- Ntfy enhancements (topic routing, priority levels, action buttons)
- Webhook trigger template customization for arbitrary integrations

**Competitors with this:** Watchtower (Shoutrrr), Diun (Teams, Matrix)
**Effort:** Low per provider

### 4.3 Release Notes in Notifications

Automatically fetch and embed release notes / changelogs in update notifications.

- Map container images to source repositories (GHCR -> GitHub repo, Docker Hub source URL metadata)
- Fetch GitHub/GitLab Releases API for new tags
- Include release notes summary in trigger notification payloads (Slack, Discord, Teams, email, etc.)
- `dd.source.repo=github.com/org/repo` label for manual mapping when auto-detection fails
- UI: show release notes in container detail panel alongside update info
- Start with GitHub Releases, expand to GitLab/Gitea/Forgejo

**Competitors with this:** Renovate (in PR body), Dependabot (in PR body)
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

**Competitors with this:** Diun (YAML), Renovate (JSON/JSON5), Portainer (UI-driven config persistence)
**Effort:** Medium-Large (foundation investment)

### 5.2 Aggregated Multi-Agent Dashboard

Unified view across all agents without requiring source selection.

- Dashboard shows all containers from all agents in one list
- Filter/group by: agent, registry, update status, tag type
- Bulk actions: "Update all" with confirmation, "Snooze all patch updates"
- Agent health overview: connected/disconnected/last-seen status bar

**Competitors with this:** Komodo (aggregated multi-host view)
**Effort:** Medium

### 5.3 Container Groups / Labels

Organize containers into user-defined groups.

- `dd.group=production` / `dd.group=staging` container labels
- UI: group-based filtering and batch operations
- Per-group policies and trigger routing

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

**Competitors with this:** Tugtainer (linked containers), Portainer (stack-aware)
**Effort:** Medium

### 5.6 Static Image List Monitoring

Watch images that aren't tied to running containers.

- New watcher provider type: `DD_WATCHER_{name}_PROVIDER=file`
- `DD_WATCHER_{name}_FILE=/config/images.yml` -- YAML list of images to monitor
- Synthetic container representation for downstream compatibility
- Use cases: pre-pull staging images, CI pipeline base images, Dockerfile FROM monitoring
- Supports all existing tag filtering, registry auth, and trigger routing

**Competitors with this:** Diun (file provider, Dockerfile provider)
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

**Competitors with this:** Portainer (full UI config), Tugtainer (per-container UI config)
**Effort:** Large (but high-impact, Portainer's #1 UX advantage)

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

**Competitors with this:** Shepherd, Diun (Swarm provider), Portainer
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

**Competitors with this:** Keel, Flux CD, Argo CD
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

**Competitors with this:** Argo Rollouts, Flux CD (Flagger)  
**Effort:** High

## Not Planned

| Feature | Reason |
| --------- | -------- |
| Git PR workflow | Renovate's domain; drydock is runtime monitoring, not source-dependency management |
| RBAC / multi-user roles | Enterprise feature, not our target audience; OIDC + basic auth covers access control |
| 90+ package managers | Out of scope for a container-focused product |
| Docker run to compose converter | Dockge/compose management domain |
| Interactive compose editor | Dockge/Portainer territory |
| Podman/containerd support | Reassess after Kubernetes watcher ships (Phase 6); Podman's Docker-compat API may work with minimal changes |

## Already Functional (Documentation Needed)

| Feature | Status |
| --------- | -------- |
| Self-update | The Docker trigger can already update drydock's own container. The UI has a self-update overlay with auto-reconnect. Needs documentation and explicit testing to confirm end-to-end reliability. |
