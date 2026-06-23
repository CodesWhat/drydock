<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Open source container update monitoring — built in TypeScript with modern tooling.**

</div>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/badge/version-1.5.0-blue" alt="Version"></a>
  <a href="https://github.com/CodesWhat/drydock/pkgs/container/drydock"><img src="https://img.shields.io/badge/GHCR-100K%2B_pulls-2ea44f?logo=github&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://hub.docker.com/r/codeswhat/drydock"><img src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker+Hub" alt="Docker Hub pulls"></a>
  <a href="https://quay.io/repository/codeswhat/drydock"><img src="https://img.shields.io/badge/Quay.io-image-ee0000?logo=redhat&logoColor=white" alt="Quay.io"></a>
  <br>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/docker/image-size/codeswhat/drydock/latest?logo=docker&logoColor=white&label=image%20size" alt="Image size"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-C9A227" alt="License AGPL-3.0"></a>
</p>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/stargazers"><img src="https://img.shields.io/github/stars/CodesWhat/drydock?style=flat" alt="Stars"></a>
  <a href="https://github.com/CodesWhat/drydock/forks"><img src="https://img.shields.io/github/forks/CodesWhat/drydock?style=flat" alt="Forks"></a>
  <a href="https://github.com/CodesWhat/drydock/issues"><img src="https://img.shields.io/github/issues/CodesWhat/drydock?style=flat" alt="Issues"></a>
  <a href="https://github.com/CodesWhat/drydock/commits/main"><img src="https://img.shields.io/github/last-commit/CodesWhat/drydock?style=flat" alt="Last commit"></a>
  <a href="https://github.com/CodesWhat/drydock/commits/main"><img src="https://img.shields.io/github/commit-activity/m/CodesWhat/drydock?style=flat" alt="Commit activity"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/discussions"><img src="https://img.shields.io/github/discussions/CodesWhat/drydock?style=flat" alt="Discussions"></a>
  <a href="https://github.com/CodesWhat/drydock"><img src="https://img.shields.io/github/repo-size/CodesWhat/drydock?style=flat" alt="Repo size"></a>
  <img src="https://komarev.com/ghpvc/?username=CodesWhat-drydock&label=repo+views&style=flat" alt="Repo views">
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin"></a>
</p>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.bestpractices.dev/projects/11915"><img src="https://www.bestpractices.dev/projects/11915/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <br>
  <a href="https://app.codecov.io/gh/CodesWhat/drydock"><img src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg?token=b90d4863-46c5-40d2-bf00-f6e4a79c8656" alt="Codecov"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg" alt="Maintainability"></a>
</p>

<hr>

> [!WARNING]
> **Upgrading? Read the upgrade notes first.** Release **1.4.6** and the entire **1.5** line ship security-hardening fixes that change runtime behavior — they are not deprecations and have no grace period: OIDC now requires `authorization_endpoint` in your provider's discovery metadata, unauthenticated rate-limiting keys on the TCP peer address (shared bucket behind a reverse proxy), and HTTP-trigger proxy URLs must use `http(s)://`. See **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)** before updating.

<h2 align="center">📑 Contents</h2>

- [📖 Documentation](https://getdrydock.com/docs)
- [🚀 Quick Start](#quick-start)
- [🆕 Recent Updates](#recent-updates)
- [📸 Screenshots & Live Demo](#screenshots)
- [✨ Features](#features)
- [🔌 Supported Integrations](#supported-integrations)
- [⚖️ Feature Comparison](#feature-comparison)
- [🔄 Migration](#migration)
- [🗺️ Roadmap](#roadmap)
- [⭐ Star History](#star-history)
- [🔧 Built With](#built-with)
- [🤝 Community QA](#community-qa)

<hr>

<h2 align="center" id="quick-start">🚀 Quick Start</h2>

**Recommended: use a socket proxy** to restrict which Docker API endpoints Drydock can access. This avoids giving the container full access to the Docker socket.

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      socket-proxy:
        condition: service_healthy
    environment:
      - DD_WATCHER_LOCAL_HOST=socket-proxy
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - CONTAINERS=1
      - IMAGES=1
      - EVENTS=1
      - SERVICES=1
      - INFO=1          # Required for daemon identity detection (notification prefixes)
      # Add POST=1 and NETWORKS=1 for container actions and auto-updates
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

<details>
<summary>Alternative: quick start with direct socket mount</summary>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e DD_AUTH_BASIC_ADMIN_USER=admin \
  -e "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>" \
  codeswhat/drydock:latest
```

> **Warning:** Direct socket access grants the container full control over the Docker daemon. Use the socket proxy setup above for production deployments. See the [Docker Socket Security guide](https://getdrydock.com/docs/configuration/watchers#docker-socket-security) for all options including remote TLS and rootless Docker.

</details>

> Generate a password hash (`argon2` CLI — install via your package manager):
>
> ```bash
> echo -n "yourpassword" | argon2 $(openssl rand -base64 32) -id -m 16 -t 3 -p 4 -l 64 -e
> ```
>
> Or with Node.js 24+ (no extra packages needed):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Legacy v1.3.9 Basic auth hashes (`{SHA}`, `$apr1$`/`$1$`, `crypt`, and plain) are accepted for upgrade compatibility but deprecated (removed in v1.6.0). Argon2id is recommended for all new configurations.
> Authentication is **required by default**. See the [auth docs](https://getdrydock.com/docs/configuration/authentications) for OIDC, anonymous access, and other options.
> To explicitly allow anonymous access on fresh installs, set `DD_ANONYMOUS_AUTH_CONFIRM=true`.

The image includes `trivy` and `cosign` binaries for local vulnerability scanning and image verification.

See the [Quick Start guide](https://getdrydock.com/docs/quickstart) for Docker Compose, socket security, reverse proxy, and alternative registries.

<hr>

<h2 align="center" id="recent-updates">🆕 Recent Updates</h2>

<details>
<summary><strong>Latest release highlights</strong></summary>

- **Unified update-completion toasts** — All terminal "Updated / Update failed / Rolled back" toasts now fire from a single global handler mounted at `App.vue`, with toast emission gated on the matching container-state SSE event so the toast appears the moment the row's "Updating" badge clears. Closes a long-standing intermittent-drop bug where `ContainerUpdateDialog`, `useContainerSsePatchPipeline`, and the dashboard each fired (or didn't) based on which view happened to be mounted. Includes a Last-Event-ID query-param fallback so missed terminal events get replayed from the server-side ring buffer on SSE reconnect. ([#289](https://github.com/CodesWhat/drydock/issues/289), [#290](https://github.com/CodesWhat/drydock/issues/290), [#291](https://github.com/CodesWhat/drydock/issues/291))
- **17 UI locales** — v1.5.0 ships with 17 locales: English, Simplified Chinese, Traditional Chinese, Italian, Spanish, German, French, Brazilian Portuguese, Dutch, Polish, Turkish, Japanese, Korean, Russian, Vietnamese, Ukrainian, and Arabic. Simplified and Traditional Chinese were contributed by [TianMiao](https://github.com/TianMiao) ([PR #331](https://github.com/CodesWhat/drydock/discussions/331), [PR #344](https://github.com/CodesWhat/drydock/pull/344)); the remaining 14 non-English locales were added in subsequent RCs. Switch language in **Config > Appearance**. Crowdin sync is configured for ongoing translation contributions.
- **Multi-select audit log filter** — The event-type filter in the Audit Log view is now a checkbox dropdown so you can view any combination of event categories (e.g. `update-applied` + `update-failed`) in one query. The backend `?actions=` parameter was already there; the UI now exposes it. ([discussion #332](https://github.com/CodesWhat/drydock/discussions/332))
- **Credential redaction expanded** — `update-failed` SSE error payloads now redact `x-registry-auth`, `*-token`, and `api-key` fields in addition to `Authorization` headers, so registry credentials and API keys no longer leak in operator-visible diagnostics.
- **Update eligibility blockers** — Container rows now surface structured pre-flight blockers inline (maturity hold, security block, maintenance window, policy exclusion, pinned version) so you can see exactly why an update button is disabled without opening the detail panel.
- **Scan vs. update row status** — Container rows correctly distinguish a scan-in-progress state from an update-in-progress state, so the row badge matches the actual operation type.
- **Expand / Collapse all stacks** — A single toolbar button expands or collapses every stack group at once when Stack view is enabled; the label reflects the current global expand state. Individual stack headers still toggle independently. ([#311](https://github.com/CodesWhat/drydock/discussions/311))
- **Dashboard + Containers view reconnect performance** — On SSE reconnect, both views now refetch only endpoints that can go stale (skipping static ones for 30s) and patch the local container array in place instead of replacing it. On large inventories this turns a reconnect storm into a handful of requests and eliminates the post-reconnect flicker. ([#301](https://github.com/CodesWhat/drydock/issues/301))
- **Security scan digest mode** — `SECURITYMODE=digest` (or `batch+digest`) sends one severity-grouped summary per scan cycle instead of one notification per vulnerable container. New bulk `POST /api/v1/containers/scan-all` endpoint scans the whole fleet server-side and emits a single `security-scan-cycle-complete` event; the UI **Scan All** button now uses it so a 40-container inventory produces one email instead of forty. ([#300](https://github.com/CodesWhat/drydock/discussions/300))
- **Notification dropdown rework** — The bell dropdown gains per-row ✕ dismiss, a header **Clear** bulk action, and a split footer (Mark all as read / Open audit log). New `--dd-zebra-stripe` theme token keeps alternate rows legible on every stock theme. ([#267](https://github.com/CodesWhat/drydock/discussions/267))
- **Actionable deprecation banners** — Every deprecation warning now carries the concrete migration action inline plus a "View migration guide" link that deep-jumps to the relevant anchor on the deprecations doc. ([#214](https://github.com/CodesWhat/drydock/discussions/214))
- **Per-channel notification dedup** — The batch and digest notification channels now track `once=true` dedup independently, so `MODE=batch+digest` reliably delivers both the immediate batch email and the scheduled morning digest for each detected update.
- **Container list performance** — `GET /api/containers` now preloads active update operations in a single indexed scan with per-row O(1) lookup, eliminating the rc.8 slowdown on large inventories (Dashboard / Watchers / Servers / Container Logs all benefit).
- **Persistent once-dedup** — `once=true` notification dedup survives process restarts and transient `changed=false` scan cycles via a new on-disk notification history store, so notifications no longer re-fire after a restart.
- **Hide Pinned surfaces actionable rows** — Pinned containers with a pending update stay visible when Hide Pinned is on; only static pinned rows are hidden, matching the decluttering intent without suppressing actionable updates.
- **Remote-agent updates work end-to-end** — Controller trims the remote-trigger payload for `docker` / `dockercompose` updates so the agent's json body cap can't block an update with HTTP 413.
- **Socket-proxy identity detection** — Daemon host-name detection now runs for host-based watchers (TCP to a local socket-proxy, the common Synology / Compose pattern), so notification prefixes stop falling back to container short IDs.
- **Backend-driven update queue** — Container updates queued server-side with per-trigger concurrency limits. UI shows Queued → Updating → Updated progression with sequence labels (e.g. "Updating 1 of 3"). Global cap configurable via `DD_UPDATE_MAX_CONCURRENT` (default `0` = unlimited; set to a positive integer to bound how many updates run simultaneously across the whole controller instance).
- **Identity-keyed container tracking** — Containers tracked by stable identity key (agent::watcher::name) across renames/replacements, preventing cross-host status contamination.
- **Watcher next-run schedule visibility** — Watcher API and Agents view now show when each watcher will next poll for updates.
- **Notification delivery failure audit trail** — Failed notification deliveries surface in the notification bell dropdown for visibility without leaving the UI.
- **Multi-server notification identification** — Notifications automatically include `[server-name]` prefix when agents are registered, identifying which server each update comes from. Configurable via `DD_SERVER_NAME` (defaults to the detected daemon host name, then the process hostname). Custom templates can use `container.notificationServerName`.
- **System log viewer overhaul** — Pinned toolbar, line wrapping, sort toggle (newest/oldest), filter mode (funnel icon shows matches only), auto-apply filters, component dropdown from API, aligned columns, floating copy button.
- **Hide Pinned containers** — Checkbox toggle in the container filter bar hides version-pinned containers. Persisted in user preferences.
- **Combined batch+digest notifications** — `MODE=batch+digest` sends both immediate batch emails and scheduled digest summaries.
- **Multi-host same-name container support** — Containers with identical names across different hosts no longer collide in the UI. Actions, logs, and detail panels route by container ID.
- **Lazy OIDC discovery** — SSO provider startup failures no longer block the server. Discovery retries on first use.

</details>

<hr>

<h2 align="center" id="screenshots">📸 Screenshots & Live Demo</h2>

<table>
<tr>
<td width="50%" align="center"><strong>Light</strong></td>
<td width="50%" align="center"><strong>Dark</strong></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard Light"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard Dark"></td>
</tr>
</table>

<div align="center">

**Why look at screenshots when you can experience it yourself?**

<a href="https://demo.getdrydock.com"><img src="https://img.shields.io/badge/Try_the_Live_Demo-4f46e5?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSI2IDMgMjAgMTIgNiAyMSA2IDMiLz48L3N2Zz4=&logoColor=white" alt="Try the Live Demo" height="36"></a>

Fully interactive — real UI, mock data, no install required. Runs entirely in-browser.

</div>

<hr>

<h2 align="center" id="features">✨ Features</h2>

<table>
<tr>
<td align="center" width="33%">
<h3>Container Monitoring</h3>
Auto-detect running containers and check for image updates across registries
</td>
<td align="center" width="33%">
<h3>20 Triggers (17 Notification + 3 Action)</h3>
Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, HTTP webhooks, Gotify, NTFY, and more — plus Docker, Docker Compose, and Command action triggers
</td>
<td align="center" width="33%">
<h3>23 Registry Providers</h3>
Docker Hub, GHCR, ECR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and more
</td>
</tr>
<tr>
<td align="center">
<h3>Docker Compose Updates</h3>
Auto-pull and recreate services via Docker Engine API with YAML-preserving service-scoped image patching
</td>
<td align="center">
<h3>Distributed Agents</h3>
Monitor remote Docker hosts with SSE-based agent architecture. <strong>Experimental:</strong> edge agents behind NAT/firewall dial out to drydock via WebSocket with Ed25519 public-key auth — no inbound port required (<code>DD_EXPERIMENTAL_PORTWING=true</code>)
</td>
<td align="center">
<h3>Audit Log</h3>
Event-based audit trail with persistent storage, REST API, and Prometheus counter
</td>
</tr>
<tr>
<td align="center" width="33%">
<h3>OIDC Authentication</h3>
Authelia, Auth0, Authentik — secure your dashboard with OpenID Connect
</td>
<td align="center" width="33%">
<h3>Prometheus Metrics</h3>
Built-in /metrics endpoint with optional auth bypass for monitoring stacks
</td>
<td align="center" width="33%">
<h3>Image Backup & Rollback</h3>
Automatic pre-update image backup with configurable retention and one-click rollback
</td>
</tr>
<tr>
<td align="center" width="33%">
<h3>Container Actions</h3>
Start, stop, restart, and update containers from the UI or API with feature-flag control
</td>
<td align="center" width="33%">
<h3>Webhook API</h3>
Token-authenticated CI/CD endpoints for watch/update actions plus signed registry webhook ingestion for push events
</td>
<td align="center" width="33%">
<h3>Container Grouping</h3>
Smart stack detection via compose project or labels with collapsible groups and batch-update
</td>
</tr>
<tr>
<td align="center" width="33%">
<h3>Digest Notifications</h3>
Batch update events over a schedule with trigger `MODE=digest` and configurable digest cron windows
</td>
<td align="center" width="33%">
<h3>System Log Streaming</h3>
Real-time WebSocket system log view in the UI with shared log viewer components
</td>
<td align="center" width="33%">
<h3>Advanced List API</h3>
Container list supports queryable sort/order, watched-kind, runtime status, watcher, and maturity filters
</td>
</tr>
<tr>
<td align="center" width="33%">
<h3>Lifecycle Hooks</h3>
Pre/post-update shell commands via container labels with configurable timeout and abort control
</td>
<td align="center" width="33%">
<h3>Auto Rollback</h3>
Automatic rollback on health check failure with configurable monitoring window and interval
</td>
<td align="center" width="33%">
<h3>Graceful Self-Update</h3>
DVD-style animated overlay during drydock's own container update with auto-reconnect
</td>
</tr>
<tr>
<td align="center" width="33%">
<h3>Icon CDN</h3>
Auto-resolved container icons via selfhst/icons with homarr-labs fallback and bundled selfhst seeds for internetless startup
</td>
<td align="center" width="33%">
<h3>Mobile Responsive</h3>
Fully responsive dashboard with optimized mobile breakpoints for all views
</td>
<td align="center" width="33%">
<h3>Multi-Registry Publishing</h3>
Available on GHCR, Docker Hub, and Quay.io for flexible deployment
</td>
</tr>
</table>

<hr>

<h2 align="center" id="supported-integrations">🔌 Supported Integrations</h2>

### 📦 Registries (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Custom · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### 🔔 Triggers (20)

Apprise · Command · Discord · Docker · Docker Compose · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### 🔐 Authentication

Anonymous (opt-in via `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Basic (username + password hash) · OIDC (Authelia, Auth0, Authentik). All auth flows fail closed by default.

API note: `POST /api/v1/containers/:id/env/reveal` is currently scoped to authentication only (no per-container RBAC yet), so any authenticated user is treated as a trusted operator for secret reveal actions. The unversioned `/api/containers/:id/env/reveal` alias remains available during the API-version transition.

OpenAPI note: machine-readable API docs are available at `GET /api/v1/openapi.json` (canonical) and `GET /api/openapi.json` (compatibility alias during transition).

API versioning note: third-party integrations should migrate to `/api/v1/*`. The unversioned `/api/*` alias is deprecated and will be removed in v1.6.0.

### 🥊 Update Bouncer

Trivy-powered vulnerability scanning blocks unsafe updates before they deploy. Includes cosign signature verification and SBOM generation (CycloneDX & SPDX).

<hr>

<h2 align="center" id="feature-comparison">⚖️ Feature Comparison</h2>

<details>
<summary><strong>How does drydock compare to other container update tools?</strong></summary>

> ✅ = supported &nbsp; ❌ = not supported &nbsp; ⚠️ = partial / limited &nbsp; For the full itemized changelog, see [CHANGELOG.md](CHANGELOG.md).

<table>
<thead>
<tr>
<th width="28%">Feature</th>
<th width="14%" align="center">drydock</th>
<th width="14%" align="center">WUD</th>
<th width="14%" align="center">Diun</th>
<th width="16%" align="center">Watchtower&nbsp;†</th>
<th width="14%" align="center">Ouroboros&nbsp;†</th>
</tr>
</thead>
<tbody>
<tr><td>Web UI / Dashboard</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Auto-update containers</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Docker Compose updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Notification triggers</td><td align="center">20</td><td align="center">16</td><td align="center">17</td><td align="center">~19</td><td align="center">~6</td></tr>
<tr><td>Registry providers</td><td align="center">23</td><td align="center">13</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>OIDC / SSO authentication</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>REST API</td><td align="center">✅</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Prometheus metrics</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Image backup & rollback</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container grouping / stacks</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Lifecycle hooks (pre/post)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Webhook API for CI/CD</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Container start/stop/restart/update</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Distributed agents (remote)</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Audit log</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Security scanning (Trivy)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Semver-aware updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Digest watching</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Multi-arch (amd64/arm64)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Container log viewer</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Actively maintained</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
</tbody>
</table>

> Data based on publicly available documentation as of March 2026.
> Contributions welcome if any information is inaccurate.

</details>

<hr>

<h2 align="center" id="migration">🔄 Migration</h2>

<details>
<summary><strong>Migrating from WUD (What's Up Docker?)</strong></summary>

Drop-in replacement — swap the image, restart, done. All `WUD_*` env vars and `wud.*` labels are auto-mapped at startup. State file migrates automatically. Use `config migrate --dry-run` to preview, then `config migrate --file .env --file compose.yaml` to rewrite config to drydock naming.

</details>

<hr>

<h2 align="center" id="roadmap">🗺️ Roadmap</h2>

<details>
<summary><strong>Version themes & highlights</strong></summary>

High-level themes only — see [CHANGELOG.md](CHANGELOG.md) for per-release detail.

| Version | Theme | Highlights |
| --- | --- | --- |
| **v1.3.x** ✅ | Security & Stability | Trivy scanning, Update Bouncer, SBOM, 7 new registries, 4 new triggers, re2js regex engine |
| **v1.4.x** ✅ | UI Modernization & Hardening | Tailwind 4 + custom components, 6 themes, Cmd/K palette, OpenAPI 3.1, compose-native YAML updates, dual-slot scanning, OIDC hardening |
| **v1.5.0** ✅ | Observability & i18n | trigger taxonomy split (`DD_ACTION_*`/`DD_NOTIFICATION_*`), WebSocket log viewer, dashboard customization, resource monitoring, notification outbox + DLQ, security scan digest, 17 locales, SSE Last-Event-ID replay, edge agent dial-out with Ed25519 auth (experimental, `DD_EXPERIMENTAL_PORTWING=true`) |
| **v1.6.0** | Scanner Decoupling & Release Intel | Backend-based scanner + Grype, notification templates, declarative update policy, table-only UI, SBOM off-heap storage |
| **v1.7.0** | Smart Updates & UX | Dependency-aware ordering, image prune, static image monitoring, keyboard shortcuts, PWA |
| **v1.8.0** | Fleet Management & Live Config | YAML config, live UI config, volume browser, parallel updates, SQLite store migration |
| **v2.0.0** | Platform Expansion | Docker Swarm, Kubernetes watchers/triggers, basic GitOps |
| **v2.1.0** | Advanced Deployment | Health gates, canary, durable self-update |
| **v2.2.0** | Container Operations | Web terminal, file browser, image building, Podman |
| **v2.3.0** | Automation & DevX | API keys, passkey, TOTP, TypeScript actions, CLI |
| **v2.4.0** | Data Safety & Templates | Scheduled backups, compose templates, secret management |
| **v3.0.0** | Advanced Platform | Network topology, GPU monitoring, RTL i18n |
| **v3.1.0** | Enterprise Access | RBAC, LDAP/AD, env-scoped permissions, Wolfi hardened image |
| **v3.2.0** | Drydock Socket Proxy | Built-in allowlist-filtered companion proxy |

</details>

<hr>

<h2 align="center" id="documentation">📖 Documentation</h2>

| Resource | Link |
| --- | --- |
| Website | [getdrydock.com](https://getdrydock.com/) |
| Live Demo | [demo.getdrydock.com](https://demo.getdrydock.com) |
| Docs | [getdrydock.com/docs](https://getdrydock.com/docs) |
| Configuration | [Configuration](https://getdrydock.com/docs/configuration) |
| Quick Start | [Quick Start](https://getdrydock.com/docs/quickstart) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) |
| Deprecations | [`DEPRECATIONS.md`](DEPRECATIONS.md) |
| Roadmap | See [Roadmap](#roadmap) section above |
| Contributing | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Issues | [GitHub Issues](https://github.com/CodesWhat/drydock/issues) |
| Discussions | [GitHub Discussions](https://github.com/CodesWhat/drydock/discussions) — feature requests & ideas welcome |

<hr>

<a id="star-history"></a>

<div align="center">
  <a href="https://star-history.com/#CodesWhat/drydock&Date">
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=Date" />
  </a>
</div>

---

<div align="center">

### Built With

[![TypeScript](https://img.shields.io/badge/TypeScript_5.9-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue_3-42b883?logo=vuedotjs&logoColor=fff)](https://vuejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=fff)](https://expressjs.com/)
[![Vitest](https://img.shields.io/badge/Vitest_4-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome_2.4-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=fff)](https://www.docker.com/)

[![Anthropic](https://img.shields.io/badge/Anthropic-000000?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)
[![OpenAI](https://img.shields.io/badge/OpenAI-000000?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg%3D%3D)](https://openai.com)

[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=fff)](https://www.conventionalcommits.org/)
[![Keep a Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-E05735)](https://keepachangelog.com/)

### Community QA

Thanks to the users who helped test v1.4.0 and v1.5.0 release candidates and reported bugs:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo) &middot; [@begunfx](https://github.com/begunfx) &middot; [@Ra72xx](https://github.com/Ra72xx)

### Part of the CodesWhat ecosystem

<table>
  <tr><th>Tool</th><th>Role</th></tr>
  <tr><td><b>drydock</b></td><td>Container update monitoring — web UI and notification engine</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/portwing"><b>portwing</b></a></td><td>Remote Docker agent — secure socket-level access from Drydock or standalone</td></tr>
  <tr><td><a href="https://github.com/CodesWhat/sockguard"><b>sockguard</b></a></td><td>Docker socket proxy — default-deny allowlist filter protecting the socket</td></tr>
</table>

These three tools are designed to layer: sockguard filters the socket, portwing exposes it remotely, and drydock monitors and acts on container state.

---

**[AGPL-3.0 License](LICENSE)**

<a href="https://github.com/CodesWhat"><img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28"></a>

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/codeswhat)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/codeswhat)
[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Back to top</a>

</div>
