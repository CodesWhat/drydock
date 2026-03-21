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
  <a href="https://github.com/CodesWhat/drydock/pkgs/container/drydock"><img src="https://img.shields.io/badge/GHCR-45K%2B_pulls-2ea44f?logo=github&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://hub.docker.com/r/codeswhat/drydock"><img src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker+Hub" alt="Docker Hub pulls"></a>
  <a href="https://quay.io/repository/codeswhat/drydock"><img src="https://img.shields.io/badge/Quay.io-image-ee0000?logo=redhat&logoColor=white" alt="Quay.io"></a>
  <br>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://ghcr-badge.egpl.dev/codeswhat/drydock/size" alt="Image size"></a>
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
</p>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/10-ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/10-ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.bestpractices.dev/projects/11915"><img src="https://www.bestpractices.dev/projects/11915/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <br>
  <a href="https://app.codecov.io/gh/CodesWhat/drydock"><img src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg?token=b90d4863-46c5-40d2-bf00-f6e4a79c8656" alt="Codecov"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg" alt="Maintainability"></a>
  <a href="https://snyk.io/test/github/CodesWhat/drydock?targetFile=app/package.json"><img src="https://snyk.io/test/github/CodesWhat/drydock/badge.svg?targetFile=app/package.json" alt="Snyk"></a>
</p>

<hr>

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

- **Digest notifications for triggers** — Batch update events with `MODE=digest` and configurable `DIGESTCRON`.
- **System log WebSocket streaming** — Live system logs in the UI with backend WebSocket streaming support.
- **Richer container list API controls** — `sort`/`order`, watched-kind filtering (`kind=watched|unwatched|all`), runtime status filtering, and maturity filtering.
- **Watcher run visibility** — Watcher metadata now includes `lastRunAt`, shown in the UI as a relative timestamp.

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
<h3>20 Notification Triggers</h3>
Slack, Discord, Telegram, Teams, Matrix, SMTP, MQTT, HTTP webhooks, Gotify, NTFY, and more
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
Monitor remote Docker hosts with SSE-based agent architecture
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

> Data based on publicly available documentation as of February 2026.
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

| Version | Theme | Highlights |
| --- | --- | --- |
| **v1.3.x** ✅ | Security & Stability | Trivy scanning, Update Bouncer, SBOM, 7 new registries, 4 new triggers, rollback fixes, GHCR auth, self-hosted TLS, re2js regex engine, compose trigger fixes, DB persistence on shutdown |
| **v1.4.0** ✅ | UI Modernization & Hardening | Tailwind CSS 4 + custom component library, 6 themes, 7 icon libraries, font size preference, Cmd/K command palette, OpenAPI 3.1.0 endpoint, standardized API responses with pagination, compose-native YAML-preserving updates, rename-first rollback with health gates, self-update controller with SSE ack, fail-closed auth enforcement, OIDC redirect URL validation, tag-family semver, notification rules, container grouping by stack, audit history view, dual-slot security scanning, scheduled scans, WUD migration CLI, bundled offline icons, dashboard drag-reorder, gzip compression, API error sanitization, agent log validation, TLS path redaction, audit store indexing with 30-day retention, type-safe store modules, durable batch scans, recent-status API, advisory-only security scanning, compose trigger hardening (auto-detection, validation, reconciliation, digest pinning, batch mode, multi-file awareness), reactive server feature flags, identity-aware rate limiting, API hardening |
| **v1.4.1** ✅ | Patch & Polish | Headless mode (API-only), maturity-based update policy (NEW/MATURE badges), `?groupByStack=true` URL param, agent handshake + SSE fix (#141), mangled hash detection + anonymous fallback + login error surfacing (#147), CSRF behind reverse proxies (#146), compose trigger affinity across remapped roots, CSP inline style elimination, connection-lost animation, LokiJS metadata stripping, timing side-channel fix, image hardening |
| **v1.4.2** ✅ | Bug Fixes | Watcher container count fix (#155), container recreate alias filtering (#156), stale store data fix (#157), CI versioned-only images (#154), maturity badge sizing, dependency upgrades |
| **v1.4.3** ✅ | DNS & Security | Configurable DNS result ordering for Alpine EAI_AGAIN fix (#161), Docker socket security guide, zizmor blocking in CI, scoped GitHub environments |
| **v1.4.4** ✅ | UI Polish & Hardening | Alias dedup hardening with 30s transient window (#156), dashboard host-status for remote watchers (#155), tooltip viewport fix (#165), click-to-copy version tags (#164), Simple Icons dark mode inversion, theme switcher fix, search button polish, URL rebrand to getdrydock.com |
| **v1.5.0** ✅ | Observability & User-Requested Features | Real-time WebSocket log viewer with ANSI colors + JSON syntax highlighting, dashboard customization (grid layout, drag, resize, widget visibility), container resource monitoring (CPU/memory stats + dashboard widget), diagnostic debug dump, registry webhook receiver, trigger env var aliases (`DD_ACTION_*`/`DD_NOTIFICATION_*`), auth endpoint telemetry/guardrails, UI standardization (margins, text sizes, deprecation banners) |
| **v1.5.1** | Scanner Decoupling | Backend-based scanner execution (docker/remote), Grype provider, scanner asset lifecycle |
| **v1.6.0** | Notifications & Release Intel | Notification templates, MS Teams & Matrix triggers, remove all deprecated compatibility aliases (see [DEPRECATIONS.md](DEPRECATIONS.md)) |
| **v1.7.0** | Smart Updates & UX | Dependency-aware ordering, clickable port links, image prune, static image monitoring |
| **v1.8.0** | Fleet Management & Live Config | YAML config, live UI config panels, volume browser, parallel updates, SQLite store migration, i18n framework |
| **v2.0.0** | Platform Expansion | Docker Swarm, Kubernetes watchers and triggers, basic GitOps |
| **v2.1.0** | Advanced Deployment Patterns | Health check gates, canary deployments, durable self-update controller |
| **v2.2.0** | Container Operations | Web terminal, file browser, image building, basic Podman support |
| **v2.3.0** | Automation & Developer Experience | API keys, passkey auth, TOTP 2FA, TypeScript actions, CLI |
| **v2.4.0** | Data Safety & Templates | Scheduled backups (S3, SFTP), compose templates, secret management |
| **v3.0.0** | Advanced Platform | Network topology, GPU monitoring, full i18n translations |
| **v3.1.0** | Enterprise Access & Compliance | RBAC, LDAP/AD, environment-scoped permissions, audit logging, Wolfi hardened image |
| **v3.2.0** | Drydock Socket Proxy | Built-in companion proxy container (allowlist-filtered Docker API), rootless Docker & remote TLS security docs |

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

[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=fff)](https://www.conventionalcommits.org/)
[![Keep a Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-E05735)](https://keepachangelog.com/)

### Built With

[![TypeScript](https://img.shields.io/badge/TypeScript_5.9-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue_3-42b883?logo=vuedotjs&logoColor=fff)](https://vuejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=fff)](https://expressjs.com/)
[![Vitest](https://img.shields.io/badge/Vitest_4-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome_2.4-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=fff)](https://www.docker.com/)
[![Anthropic](https://img.shields.io/badge/Anthropic-000000?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)

### Community QA

Thanks to the users who helped test release candidates:

[@RK62](https://github.com/RK62) &middot; [@flederohr](https://github.com/flederohr) &middot; [@rj10rd](https://github.com/rj10rd) &middot; [@larueli](https://github.com/larueli) &middot; [@Waler](https://github.com/Waler) &middot; [@ElVit](https://github.com/ElVit) &middot; [@nchieffo](https://github.com/nchieffo)

---

**[AGPL-3.0 License](LICENSE)**

<a href="https://github.com/CodesWhat"><img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28"></a>

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/codeswhat)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/codeswhat)
[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Back to top</a>

</div>
