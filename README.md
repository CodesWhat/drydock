<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/whale-logo-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/whale-logo.png" />
  <img src="docs/assets/whale-logo.png" alt="drydock" width="220">
</picture>

<h1>drydock</h1>

**Container image update watcher — 23 registries, 20 notification and action providers.**

<p><strong>English</strong> · <a href="README.es.md">Español</a> · <a href="README.pl.md">Polski</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português (Brasil)</a></p>

</div>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/badge/version-1.6.0--rc.5-blue" alt="Version"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-C9A227" alt="License AGPL-3.0"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci-verify.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/test_coverage.svg" alt="Code Coverage"></a>
  <a href="https://dashboard.stryker-mutator.io/reports/github.com/CodesWhat/drydock/main"><img src="https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2FCodesWhat%2Fdrydock%2Fmain" alt="Mutation testing"></a>
  <br>
  <a href="https://github.com/CodesWhat/drydock/pkgs/container/drydock"><img src="https://img.shields.io/badge/GHCR-150K%2B_pulls-2ea44f?logo=github&logoColor=white" alt="GHCR pulls"></a>
  <a href="https://github.com/veggiemonk/awesome-docker#container-management"><img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Docker"></a>
  <a href="https://crowdin.com/project/drydock"><img src="https://badges.crowdin.net/drydock/localized.svg" alt="Crowdin localization"></a>
</p>

<hr>

> [!WARNING]
> **Updating from an older release? Read the upgrade notes first.** Three security-hardening fixes first shipped in **1.4.6** and run through the entire **1.5** line, so anyone updating from a release older than 1.4.6 is affected whatever version they land on (1.4.6, any 1.5.x, or later). They are not deprecations and have no grace period: OIDC now requires `authorization_endpoint` in your provider's discovery metadata, unauthenticated rate-limiting keys on the TCP peer address (shared bucket behind a reverse proxy), and HTTP-trigger proxy URLs must use `http(s)://`. See **[UPGRADE-NOTES.md](UPGRADE-NOTES.md)** before updating.

<!-- separate alerts: a blank-line-only gap between blockquotes trips markdownlint MD028 -->

> [!WARNING]
> **Updating to 1.6.0-rc.3 or later?** More security-hardening fixes land with no grace period. An instance with no authentication configured — or with anonymous auth enabled but unconfirmed — now **fails closed** on upgrade, exactly like a fresh install: the container runs; protected API requests return `401`; authentication discovery/status routes remain public; and `/health` returns `503`. The SPA shell may still load, but it cannot read protected application data. Set `DD_ANONYMOUS_AUTH_CONFIRM=true` or configure `DD_AUTH_BASIC_*`/OIDC before upgrading. The session cookie is renamed `connect.sid` → `drydock.sid`, signing every existing user out once. HTTP notification triggers (plus the Hass webhook and registry icon fetches) now resolve hostnames through a guarded DNS lookup that blocks cloud-metadata/link-local targets and never follow redirects — set `allowmetadata=true` on a specific `DD_NOTIFICATION_HTTP_*` trigger if you legitimately need one. See **[DEPRECATIONS.md](DEPRECATIONS.md#enforced-security-changes-no-deprecation-window)** for full migration guidance.

<h2 align="center">📑 Contents</h2>

- [📖 Documentation](https://getdrydock.com/docs)
- [🚀 Quick Start](#quick-start)
- [🆕 Recent Updates](#recent-updates)
- [📸 Screenshots & Live Demo](#screenshots)
- [🤔 Why Drydock](#why-drydock)
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
<summary>Alternative: <a href="https://github.com/CodesWhat/sockguard">sockguard</a> socket proxy</summary>

[sockguard](https://github.com/CodesWhat/sockguard) is a default-deny Docker socket filter from the same CodesWhat ecosystem, with a preset built for drydock:

```yaml
services:
  drydock:
    image: codeswhat/drydock
    depends_on:
      sockguard:
        condition: service_healthy
    environment:
      - DD_WATCHER_LOCAL_HOST=sockguard
      - DD_WATCHER_LOCAL_PORT=2375
      - DD_AUTH_BASIC_ADMIN_USER=admin
      - "DD_AUTH_BASIC_ADMIN_HASH=<paste-argon2id-hash>"
    ports:
      - 3000:3000

  sockguard:
    image: codeswhat/sockguard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./sockguard.yaml:/etc/sockguard/config.yaml:ro
    environment:
      - SOCKGUARD_CONFIG_FILE=/etc/sockguard/config.yaml
    healthcheck:
      test: wget --spider http://localhost:2375/version || exit 1
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped
```

See sockguard's [`app/configs/portwing.yaml`](https://github.com/CodesWhat/sockguard/blob/dev/v1.5/app/configs/portwing.yaml) preset for a starting `sockguard.yaml` (the same preset portwing ships in its own examples).

</details>

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
> Or with Node.js 24.7+ (no extra packages needed):
>
> ```bash
> node -e 'const c=require("node:crypto");const s=c.randomBytes(32);const h=c.argon2Sync("argon2id",{message:process.argv[1],nonce:s,memory:65536,passes:3,parallelism:4,tagLength:64});console.log("argon2id$65536$3$4$"+s.toString("base64")+"$"+h.toString("base64"));' "yourpassword"
> ```
>
> Drydock v1.6 accepts only argon2id Basic auth hashes. Legacy `{SHA}`, `$apr1$`/`$1$`, `crypt`, and plain-text hashes are rejected; regenerate them before upgrading.
> Authentication is **required by default**. See the [auth docs](https://getdrydock.com/docs/configuration/authentications) for OIDC, anonymous access, and other options.
> Anonymous access must be explicitly confirmed with `DD_ANONYMOUS_AUTH_CONFIRM=true` on new and upgraded instances alike. Without it, an instance with no auth configured (or unconfirmed anonymous auth) starts fail-closed: protected API requests return `401`, public authentication discovery/status routes remain available, and `/health` returns `503`.

The image includes `trivy` and `cosign` binaries for local vulnerability scanning and image verification.

See the [Quick Start guide](https://getdrydock.com/docs/quickstart) for Docker Compose, socket security, reverse proxy, and alternative registries.

<hr>

<h2 align="center" id="recent-updates">🆕 Recent Updates</h2>

<details open>
<summary><strong>v1.6.0-rc.5 highlights</strong></summary>

- **Notifications** — Per-rule/per-provider title and body templates with live preview, plus audit-backed in-app bell categories and update severity thresholds.
- **Dashboard** — Zero-dependency CSS Grid replacement with mouse/touch reorder, bounded resize, responsive layouts, widget visibility, reset, and optional cross-device preference sync.
- **Update policy** — Declarative watcher/label/UI precedence, override/revert audit trail, maturity countdown/manual override, and pinned-tag informational visibility with a stacked current → newer Tag view.
- **Container resources** — The Resources column remains visible by default but can now be hidden persistently; Source, release-note, and registry shortcuts stay available from each row's More menu and from card footers.
- **Performance & recovery** — Per-poll tag-list deduplication, lighter aggregate projections, virtualized large log histories, immutable live-log rollover, auth-bootstrap timeout, complete preference migrations, and stale-chunk self-healing.
- **v1.6 migrations enforced** — WUD env/label aliases, legacy auth formats, obsolete watcher switches, template aliases, Kafka `clientId`, and malformed token-only Hub/DHI public configs no longer run. The trigger-taxonomy aliases remain for one final error-level warning release.

Full migration guidance in [DEPRECATIONS.md](./DEPRECATIONS.md).

</details>

<details>
<summary><strong>v1.5.2 highlights</strong></summary>

- **Recreation-safe update policy** — Maturity gates, skipped tags/digests, and snoozes now survive container recreation for local and remote-agent workloads.
- **Pinned-tag reliability** — Fully pinned tags detect same-tag digest rebuilds again, while the UI can show a non-actionable newer same-family tag without changing update or trigger behavior.
- **Rollback recovery** — Failed replacement creation, network attachment, or startup now cleans up the candidate before restoring the original container, and repeated failures cannot cascade through nested rollback renames.
- **Safer container recreation** — Daemon-assigned MAC addresses are no longer pinned onto replacements, while explicitly configured primary-network MAC addresses remain preserved.
- **Quieter local-image polling** — Locally built or loaded images with no registry digest skip remote lookups instead of generating recurring authorization errors.

Full history in [CHANGELOG.md](./CHANGELOG.md).

</details>

<hr>

<h2 align="center" id="screenshots">📸 Screenshots & Live Demo</h2>

<p align="center">
  <img src="docs/assets/drydock-demo.gif" alt="Drydock detecting and applying a container update" width="880">
</p>

<p align="center"><em>Spot an update, see exactly what changes, apply it. Backup, health check, and rollback handled.</em></p>

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

<h2 align="center" id="why-drydock">🤔 Why Drydock</h2>

Container images drift out of date silently. A base image patches a CVE, an app cuts a release, a tag moves. Unless you're watching every registry by hand, your running containers fall behind until something breaks or gets exploited.

Most tools force a tradeoff. The auto-updaters (Watchtower, Ouroboros) pull and restart with little visibility or control, and are now largely unmaintained. The dashboards (Portainer) manage containers but aren't built for update intelligence. Drydock is **monitor-first**: it watches 23 registries and tells you exactly what changed (major, minor, patch, or digest) before anything happens, then acts only when you let it. And it goes further than any of them. Trivy/Grype vulnerability scanning blocks unsafe updates, cosign verifies signatures, pre-update image backups roll back automatically on health-check failure, distributed agents cover remote hosts, and 20 notification and action integrations close the loop. The full update lifecycle, with a web UI and a REST API.

<hr>

<h2 align="center" id="features">✨ Features</h2>

| | Feature | Description |
|---|---|---|
| 🔭 | **Monitor-First Detection** | Watches every running container and classifies each available update as major, minor, patch, or digest before anything happens. Nothing changes until you say so. |
| 📦 | **23 Registry Providers** | Docker Hub, GHCR, ECR, ACR, GCR, GAR, GitLab, Quay, Harbor, Artifactory, Nexus, and 12 more. Public and private, cloud and self-hosted, with per-registry TLS and auth. |
| 🔔 | **20 Triggers** | 17 notification channels (Slack, Discord, Telegram, Teams, SMTP, MQTT, ntfy, and more) plus Docker, Docker Compose, and Command actions, with per-event/provider templates, live preview, threshold filtering, and batch mode. |
| 🥊 | **Update Bouncer** | Trivy/Grype vulnerability scanning blocks unsafe updates before they deploy, with cosign signature verification and SBOM generation (CycloneDX and SPDX). |
| ↩️ | **Image Backup & Auto Rollback** | Pre-update image snapshots with configurable retention, automatic rollback on health-check failure, and one-click manual rollback from the UI. |
| 🪝 | **Lifecycle Hooks** | Pre and post-update shell commands via container labels, with per-hook timeouts and abort-on-failure control. |
| 🗂️ | **Docker Compose Updates** | Pull and recreate Compose services through the Docker Engine API with YAML-preserving image patching. |
| 🎛️ | **Per-Container Policy** | Regex tag rules and trigger routing use `dd.*` labels; maturity gates, skip/snooze/pin, and maintenance windows are stored via UI/API or watcher configuration. |
| 🛰️ | **Distributed Agents** | Monitor remote Docker hosts over SSE. Edge agents behind NAT dial out over WebSocket with Ed25519 key auth, no inbound port required (`DD_EXPERIMENTAL_PORTWING=true`). |
| 🖥️ | **Web Dashboard** | Vue 3 UI with a zero-dependency customizable widget grid, responsive table/card views, live SSE updates, notification-bell controls, and per-container detail, logs, and stats. |
| 🔗 | **REST API & Webhooks** | Token-authenticated endpoints for CI/CD watch and update triggers, plus signed registry webhook ingestion for push events. |
| 🔐 | **OIDC Authentication** | Secure the dashboard with OpenID Connect (Authelia, Auth0, Authentik). All auth flows fail closed by default. |
| 📈 | **Prometheus Metrics** | Built-in `/metrics` endpoint with optional auth bypass for Prometheus and Grafana monitoring stacks. |
| 🌍 | **17 UI Locales** | Fully wired translation system with English complete and 16 community-maintained locales synced through Crowdin, switchable in Config. |
| 🔒 | **ReDoS-Immune Regex** | Every user-supplied tag pattern compiles via re2js (a pure-JS RE2 port) for linear-time matching that can't be stalled by a catastrophic-backtracking pattern. |

<hr>

<h2 align="center" id="supported-integrations">🔌 Supported Integrations</h2>

### 📦 Registries (23)

Docker Hub · GHCR · ECR · ACR · GCR · GAR · GitLab · Quay · LSCR · Harbor · Artifactory · Nexus · Gitea · Forgejo · Codeberg · MAU · TrueForge · Custom · DOCR · DHI · IBM Cloud · Oracle Cloud · Alibaba Cloud

### ⚡ Actions (3)

Docker · Docker Compose · Command

### 🔔 Notifications (17)

Apprise · Discord · Google Chat · Gotify · HTTP · IFTTT · Kafka · Matrix · Mattermost · MQTT · MS Teams · NTFY · Pushover · Rocket.Chat · Slack · SMTP · Telegram

### 🔐 Authentication

Anonymous (opt-in via `DD_ANONYMOUS_AUTH_CONFIRM=true`) · Basic (username + password hash) · OIDC (Authelia, Auth0, Authentik). All auth flows fail closed by default.

### 🥊 Update Bouncer

Trivy- or Grype-powered vulnerability scanning blocks unsafe updates before they deploy. Includes cosign signature verification and SBOM generation (CycloneDX & SPDX).

<hr>

<h2 align="center" id="feature-comparison">⚖️ Feature Comparison</h2>

<details>
<summary><strong>How does drydock compare to other container update tools?</strong></summary>

> ✅ = supported &nbsp; ❌ = not supported &nbsp; ⚠️ = partial / limited &nbsp; † = archived, no longer maintained

<table>
<thead>
<tr>
<th width="28%">Feature</th>
<th width="15%" align="center">drydock</th>
<th width="15%" align="center">WUD</th>
<th width="15%" align="center">Diun</th>
<th width="13%" align="center"><em>Watchtower&nbsp;†</em></th>
<th width="14%" align="center"><em>Ouroboros&nbsp;†</em></th>
</tr>
</thead>
<tbody>
<tr><td>Web UI / Dashboard</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Auto-update containers</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Docker Compose updates</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Trigger / notification channels</td><td align="center">20</td><td align="center">16</td><td align="center">17</td><td align="center">~19</td><td align="center">~6</td></tr>
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
<tr><td>Security scanning (Trivy/Grype)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
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

Drydock v1.6 no longer loads `WUD_*` environment variables or `wud.*` labels at runtime. Rewrite them before starting the upgraded service; persisted state still migrates automatically. Use `docker exec -it drydock node dist/index.js config migrate --dry-run` to preview, then `docker exec -it drydock node dist/index.js config migrate --file .env --file compose.yaml` to rewrite configuration to `DD_*` and `dd.*` naming.

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
| **v1.5.1** ✅ | Security & Maintenance | GCR/GAR pull-auth fix, registry TLS completion (M-2), hook env-var injection hardening, `DD_SESSION_SECRET__FILE` support, debug-dump credential redaction, secret-file permission check, maturity gate deadlock fix, full UI translatability + community translations, maintenance-window auto-apply gate, container uptime display, Tag/Version column split surfacing software version (OCI label, with `dd.inspect.tag.path` dual-write + opt-in `dd.inspect.tag.version-only` routing), opt-in compose mount-prefix matching, `${currentReleaseNotes}` template var |
| **v1.5.2** ✅ | Policy & Pinned-Tag Reliability | Recreation-safe maturity/skip/snooze policy retention, pinned-tag digest rebuild detection and informational same-family insights, rollback-candidate cleanup, rollback-cascade prevention, explicit-MAC preservation, and local-image registry-skip behavior |
| **v1.6.0** | Notifications, Policy & Release Intel | Per-rule/per-trigger notification templates with live preview, notification-bell preferences, cross-device preference sync, zero-dependency custom dashboard grid ([#281](https://github.com/CodesWhat/drydock/issues/281)), declarative update policy ([#320](https://github.com/CodesWhat/drydock/issues/320)), maturity stabilization countdown + immediate candidate visibility + manual override ([#406](https://github.com/CodesWhat/drydock/discussions/406)), actionable Update Status panel and global `notify` / `manual` / `auto` update mode ([#325](https://github.com/CodesWhat/drydock/discussions/325)), watcher/imgset/container tag-policy inheritance plus stacked current → newer pinned-tag visibility ([#498](https://github.com/CodesWhat/drydock/issues/498)), standardized 44px Source / release notes / registry resource actions across table, cards, and details ([#295](https://github.com/CodesWhat/drydock/discussions/295)), health-status event notifications ([#198](https://github.com/CodesWhat/drydock/discussions/198)), bidirectional Home Assistant MQTT, responsive table/card list views, Trivy/Grype/both scanning across command or pinned Docker-worker backends, scanner asset pull/warm controls, off-heap deduplicated SBOM storage, Trivy long-scan correctness ([#490](https://github.com/CodesWhat/drydock/issues/490)), trigger-taxonomy migration warnings, v1.6 compatibility removals, docs/API hygiene, and `/api` → `/api/v1` migration completion with an opt-in wud-card/Homepage compatibility shim (`DD_COMPAT_WUDCARD`). |
| **v1.7.0** | Smart Updates & UX | Dependency-aware ordering ([#219](https://github.com/CodesWhat/drydock/discussions/219)), selective bulk updates ([#232](https://github.com/CodesWhat/drydock/discussions/232)), per-action update policy ([#511](https://github.com/CodesWhat/drydock/discussions/511)), image prune, static image monitoring, image maturity indicator, unified maturity/update-age clock, clickable port links, keyboard shortcuts, PWA, `DD_TRIGGER_*` removal (end of the v1.5.0 deprecation window), curl removed from the image |
| **v1.8.0** | Fleet Management & Live Config | YAML config, live UI config, volume browser, parallel updates, SQLite store migration |
| **v2.0+** | Platform Expansion & Beyond | Swarm/Kubernetes watchers, GitOps, health gates, canary deploys, web terminal, RBAC, scoped rotatable API keys (static bearer tokens for HA/dashboard integrations, [#469](https://github.com/CodesWhat/drydock/discussions/469)), LDAP/AD, native Podman provider beyond the Docker-compatible API, CLI, Wolfi hardened image, socket proxy |

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

[![TypeScript](https://img.shields.io/badge/TypeScript_6.0-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![Vue 3](https://img.shields.io/badge/Vue_3-42b883?logo=vuedotjs&logoColor=fff)](https://vuejs.org/)
[![Express 5](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=fff)](https://expressjs.com/)
[![Vitest](https://img.shields.io/badge/Vitest_4-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)
[![Biome](https://img.shields.io/badge/Biome_2.5-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Anthropic](https://img.shields.io/badge/Anthropic-CC785C?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)
[![OpenAI](https://img.shields.io/badge/OpenAI-10A37F?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg%3D%3D)](https://openai.com)

[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=fff)](https://www.conventionalcommits.org/)
[![Keep a Changelog](https://img.shields.io/badge/changelog-Keep%20a%20Changelog-E05735)](https://keepachangelog.com/)

### Community

Questions, feedback, and early support: **[CodesWhat Discord](https://discord.gg/mWHCPJRzSx)**

Please file concrete bugs and feature requests in **[GitHub Issues](https://github.com/CodesWhat/drydock/issues)** so they do not get lost in chat.

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

See [portwing's COMPATIBILITY.md](https://github.com/CodesWhat/portwing/blob/main/COMPATIBILITY.md) for the full compatibility matrix across all three tools.

---

**[AGPL-3.0 License](LICENSE)**

<a href="https://github.com/CodesWhat">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/codeswhat-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/codeswhat-logo-original.svg" />
    <img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28">
  </picture>
</a>

[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Back to top</a>

</div>
