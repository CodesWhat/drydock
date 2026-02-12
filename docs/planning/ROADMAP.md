# Roadmap

Last updated: 2026-02-12

This file is the canonical planning roadmap.
Completed work has been intentionally removed.

## Current State

`feature/v1.2.0` remains active with one roadmap item pending:
- Maintenance windows final QA sign-off (manual validation still pending; automated run partially blocked by baseline lint/type debt)

Next release targets:
- `v1.3.0`: Security Integration
- `v1.4.0`: UI stack modernization (PrimeVue migration + UX refresh)

## Prioritized Backlog (Competitive Analysis)

Based on analysis of Watchtower, Diun, Dozzle, Portainer, Yacht, Shepherd, Renovate, Keel, and Flux CD.

### Tier 1 -- High-value, builds on existing strengths

| Feature | Competitor(s) | Complexity | Notes |
|---------|---------------|------------|-------|
| Lifecycle hooks (pre/post-update) | Watchtower | Medium | Labels like `dd.lifecycle.pre-update` to run commands before/after updates (e.g. DB backup before Postgres update) |
| Dependency-aware update ordering | Watchtower | Medium | Detect `depends_on` / network links, topological sort, update dependencies first |
| Automatic rollback on failure | Shepherd | Medium | Health check after update (HTTP probe, TCP, exec), auto-rollback to backup if unhealthy |
| Container actions (start/stop/restart) | Dozzle, Portainer | Small | Opt-in via env var, respect OIDC roles |
| HTTP API for on-demand triggers | Watchtower | Small | `POST /api/update` endpoint for CI/CD webhook integration |

### Tier 2 -- Strategic differentiators

| Feature | Competitor(s) | Complexity | Notes |
|---------|---------------|------------|-------|
| Image vulnerability / CVE scanning | Renovate, Portainer | Medium | Trivy integration, severity badges in UI, prioritize security updates in notifications |
| Tag regex include/exclude filters | Diun | Small | `dd.tag.include` / `dd.tag.exclude` with regex, `watch_repo` mode |
| Container grouping / stack views | Dozzle | Small-Medium | Auto-group by Compose project, collapsible groups, per-stack actions |
| Changelog / release notes in notifications | Renovate | Medium | Map images to source repos, fetch GitHub/GitLab release notes for new tags |

### Tier 3 -- Platform expansion

| Feature | Competitor(s) | Complexity | Notes |
|---------|---------------|------------|-------|
| Kubernetes provider | Diun, Portainer, Dozzle | Large | Watch pods/deployments, check images, biggest addressable market gap |
| Docker Swarm service provider | Shepherd, Diun | Medium | Detect services, `docker service update --image` |
| Watch non-running / static images | Diun | Small-Medium | File provider for YAML image lists, Dockerfile extraction |
| Web terminal / container shell | Dozzle, Portainer | Medium | xterm.js WebSocket terminal, opt-in |
| Digest pinning advisory | Renovate | Small | Warn on `:latest` usage, offer one-click pin to current digest |

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

**Success criteria**
- No new components use external `src="./Component.ts"` script pattern
- Home, Containers, and App shell are fully migrated with passing unit tests
- Team contribution guide updated with the canonical component pattern

### 3.2 Vite-Native Runtime and Build Cleanup

Remove Vue CLI-era runtime assumptions and align with current Vite conventions.

- Replace `process.env.BASE_URL`/`process.env.NODE_ENV` usage with `import.meta.env.*`
- Replace legacy `register-service-worker` integration with a Vite-compatible approach (or remove if not required)
- Keep route-level lazy loading, and add typed route-name constants for guards/navigation
- Document env variable conventions for UI (`VITE_*`) in docs

**Success criteria**
- No `process.env.*` usage remains in UI runtime code
- Service worker behavior is explicit, testable, and documented
- Router auth guard and redirect behavior covered by tests without warnings

### 3.3 Test and Performance Hardening

Clean up warnings and reduce bundle risk while keeping current feature behavior stable.

- Introduce a shared Vue test harness (router + component stubs/plugins) to remove unresolved component warnings
- Add bundle budget checks and track main chunk size trend in CI artifacts
- Split heavy UI modules/chunks where practical (icons/assets/views) to reduce initial load
- Add one Playwright smoke test for login -> dashboard -> containers path

**Success criteria**
- Unit tests pass without repeated router/component resolution warnings
- Production build emits no new large-chunk regressions above defined budget
- Smoke test passes in CI on every PR touching `ui/`

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

### 4.2 Notification Channels (Matrix, Ntfy Improvements)

Expand notification coverage based on user demand.

- Matrix trigger provider
- Ntfy enhancements (topic routing, priority levels, action buttons)
- Webhook trigger template customization for arbitrary integrations

**Effort:** Low per provider

## Phase 5: Fleet Management

**Goal:** Better UX for managing many containers across many hosts.
**Timeline target:** v1.6.0

### 5.1 Aggregated Multi-Agent Dashboard

Unified view across all agents without requiring source selection.

- Dashboard shows all containers from all agents in one list
- Filter/group by: agent, registry, update status, tag type
- Bulk actions: "Update all" with confirmation, "Snooze all patch updates"
- Agent health overview: connected/disconnected/last-seen status bar

**Competitors with this:** Komodo (aggregated multi-host view)  
**Effort:** Medium

### 5.2 Container Groups / Labels

Organize containers into user-defined groups.

- `dd.group=production` / `dd.group=staging` container labels
- UI: group-based filtering and batch operations
- Per-group policies and trigger routing

**Effort:** Medium

## Phase 6: Kubernetes Watcher

**Goal:** Monitor Kubernetes deployments for image updates.
**Timeline target:** v2.0.0

### 6.1 Kubernetes Watcher Provider

New watcher provider alongside Docker watcher.

- `DD_WATCHER_{name}_PROVIDER=kubernetes`
- `DD_WATCHER_{name}_KUBECONFIG` -- path to kubeconfig (or in-cluster service account)
- `DD_WATCHER_{name}_NAMESPACE` -- namespace filter (default: all)
- Watch Deployments, StatefulSets, DaemonSets, CronJobs for container images
- Use K8s watch API for real-time container changes

### 6.2 Kubernetes Update Triggers

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
|---------|--------|
| Git PR workflow | Renovate's domain; drydock is runtime monitoring, not source-dependency management |
| 90+ package managers | Out of scope for a container-focused product |
| Docker run to compose converter | Dockge/compose management domain |
| Interactive compose editor | Dockge/Portainer territory |
| Podman/containerd support | Reassess after Kubernetes watcher ships |
| Self-update | Users should control update mechanism |
