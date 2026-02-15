<div align="center">

<img src="docs/assets/whale-logo.png" alt="drydock" width="220">

<h1>drydock</h1>

**Open source container update monitoring — built in TypeScript with modern tooling.**

</div>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/badge/version-1.3.0-blue" alt="Version"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/GHCR-image-2ea44f?logo=docker&logoColor=white" alt="GHCR package"></a>
  <a href="https://hub.docker.com/r/codeswhat/drydock"><img src="https://img.shields.io/docker/pulls/codeswhat/drydock?logo=docker&logoColor=white&label=Docker+Hub" alt="Docker Hub pulls"></a>
  <a href="https://quay.io/repository/codeswhat/drydock"><img src="https://img.shields.io/badge/Quay.io-image-ee0000?logo=redhat&logoColor=white" alt="Quay.io"></a>
  <br>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-informational?logo=linux&logoColor=white" alt="Multi-arch"></a>
  <a href="https://github.com/orgs/CodesWhat/packages/container/package/drydock"><img src="https://ghcr-badge.egpl.dev/codeswhat/drydock/size" alt="Image size"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-C9A227" alt="License MIT"></a>
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
</p>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/actions/workflows/ci.yml"><img src="https://github.com/CodesWhat/drydock/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://www.bestpractices.dev/projects/11915"><img src="https://www.bestpractices.dev/projects/11915/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/CodesWhat/drydock"><img src="https://img.shields.io/ossf-scorecard/github.com/CodesWhat/drydock?label=openssf+scorecard&style=flat" alt="OpenSSF Scorecard"></a>
  <br>
  <a href="https://app.codecov.io/gh/CodesWhat/drydock"><img src="https://codecov.io/gh/CodesWhat/drydock/graph/badge.svg?token=b90d4863-46c5-40d2-bf00-f6e4a79c8656" alt="Codecov"></a>
  <a href="https://qlty.sh/gh/CodesWhat/projects/drydock"><img src="https://qlty.sh/gh/CodesWhat/projects/drydock/maintainability.svg" alt="Maintainability"></a>
  <a href="https://snyk.io/test/github/CodesWhat/drydock?targetFile=app/package.json"><img src="https://snyk.io/test/github/CodesWhat/drydock/badge.svg?targetFile=app/package.json" alt="Snyk"></a>
</p>

<h2 align="center">Contents</h2>

---

- [Quick Start](#quick-start)
- [Screenshots](#screenshots)
- [Features](#features)
- [Update Guard](#update-guard)
- [Migrating from WUD](#migrating-from-wud)
- [Supported Registries](#supported-registries)
- [Supported Triggers](#supported-triggers)
- [Authentication](#authentication)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Star History](#star-history)
- [Built With](#built-with)

<h2 align="center" id="quick-start">Quick Start</h2>

---

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  codeswhat/drydock:latest
```

<details>
<summary><strong>Docker Compose</strong></summary>

```yaml
services:
  drydock:
    image: codeswhat/drydock:latest
    container_name: drydock
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
```

</details>

<details>
<summary><strong>Alternative registries</strong></summary>

```bash
# GHCR
docker pull ghcr.io/codeswhat/drydock:latest

# Quay.io
docker pull quay.io/codeswhat/drydock:latest
```

</details>

<details>
<summary><strong>Verify it's running</strong></summary>

```bash
# Health check
curl http://localhost:3000/health

# Open the UI
open http://localhost:3000
```

</details>

<details>
<summary><strong>If GHCR requires auth</strong></summary>

```bash
echo '<GITHUB_PAT>' | docker login ghcr.io -u <github-username> --password-stdin
docker pull ghcr.io/codeswhat/drydock:latest
```

</details>

<details>
<summary><strong>Behind a reverse proxy (Traefik, nginx, Caddy, etc.)</strong></summary>

If drydock sits behind a reverse proxy, set `DD_SERVER_TRUSTPROXY` so Express correctly resolves the client IP from `X-Forwarded-For` headers. This is required for rate limiting to work per-client instead of per-proxy.

```yaml
environment:
  # Number of trusted hops (1 = single reverse proxy)
  - DD_SERVER_TRUSTPROXY=1
```

Accepted values: `false` (default — no proxy), `true` (trust all), a number (hop count), or an IP/CIDR string. See the [Express trust proxy docs](https://expressjs.com/en/guide/behind-proxies.html) for details.

</details>

<h2 align="center" id="screenshots">Screenshots</h2>

---

<table>
<tr>
<th align="center">Light</th>
<th align="center">Dark</th>
</tr>
<tr>
<td><img src="docs/assets/drydock-login-light.png" alt="Login (light)" width="400"></td>
<td><img src="docs/assets/drydock-login-dark.png" alt="Login (dark)" width="400"></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-dashboard-light.png" alt="Dashboard (light)" width="400"></td>
<td><img src="docs/assets/drydock-dashboard-dark.png" alt="Dashboard (dark)" width="400"></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-containers-light.png" alt="Containers (light)" width="400"></td>
<td><img src="docs/assets/drydock-containers-dark.png" alt="Containers (dark)" width="400"></td>
</tr>
<tr>
<td><img src="docs/assets/drydock-container-detail-light.png" alt="Container detail (light)" width="400"></td>
<td><img src="docs/assets/drydock-container-detail-dark.png" alt="Container detail (dark)" width="400"></td>
</tr>
<tr>
<td align="center"><img src="docs/assets/drydock-mobile-dashboard-light.png" alt="Mobile dashboard (light)" width="200"></td>
<td align="center"><img src="docs/assets/drydock-mobile-dashboard-dark.png" alt="Mobile dashboard (dark)" width="200"></td>
</tr>
<tr>
<td align="center"><img src="docs/assets/drydock-mobile-containers-light.png" alt="Mobile containers (light)" width="200"></td>
<td align="center"><img src="docs/assets/drydock-mobile-containers-dark.png" alt="Mobile containers (dark)" width="200"></td>
</tr>
</table>

<h2 align="center" id="features">Features</h2>

---

<table>
<tr>
<td align="center" width="33%">
<h3>Container Monitoring</h3>
Auto-detect running containers and check for image updates across registries
</td>
<td align="center" width="33%">
<h3>16 Notification Triggers</h3>
Slack, Discord, Telegram, SMTP, MQTT, HTTP webhooks, Gotify, NTFY, and more
</td>
<td align="center" width="33%">
<h3>10+ Registry Providers</h3>
Docker Hub, GHCR, ECR, GCR, GitLab, Quay, LSCR, Codeberg, DHI, and custom
</td>
</tr>
<tr>
<td align="center">
<h3>Docker Compose Updates</h3>
Auto-pull and recreate services via docker-compose with multi-network support
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
Token-authenticated HTTP endpoints for CI/CD integration to trigger watch cycles and updates
</td>
<td align="center" width="33%">
<h3>Container Grouping</h3>
Smart stack detection via compose project or labels with collapsible groups and batch-update
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
Auto-resolved container icons via selfhst/icons with homarr-labs fallback
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

<h2 align="center" id="update-guard">Update Guard</h2>

---

`Update Guard` adds a Trivy-powered safe-pull gate before container updates:

1. Scan the candidate image before pull/restart
2. Block the update when vulnerabilities exceed configured severity threshold
3. Verify candidate image signatures with cosign (optional block gate)
4. Generate SBOM documents (`spdx-json`, `cyclonedx-json`) for candidate images
5. Persist security state to `container.security.{scan,signature,sbom}` for API/UI visibility

Security scanning is disabled by default and is enabled with `DD_SECURITY_SCANNER=trivy`.

> **v1.3.0+:** The official drydock image now includes both `trivy` and `cosign` — no custom image required for local CLI mode.

```yaml
services:
  drydock:
    image: codeswhat/drydock:latest
    environment:
      - DD_SECURITY_SCANNER=trivy
      - DD_SECURITY_BLOCK_SEVERITY=CRITICAL,HIGH
      # Optional: block updates when signature verification fails
      # - DD_SECURITY_VERIFY_SIGNATURES=true
      # - DD_SECURITY_COSIGN_KEY=/keys/cosign.pub
      # Optional: generate and persist SBOM
      # - DD_SECURITY_SBOM_ENABLED=true
      # - DD_SECURITY_SBOM_FORMATS=spdx-json,cyclonedx-json
      # Optional: use Trivy server mode instead of local CLI
      # - DD_SECURITY_TRIVY_SERVER=http://trivy:4954
```

Security APIs:

- `GET /api/containers/:id/vulnerabilities`
- `GET /api/containers/:id/sbom?format={format}` where `format` is `spdx-json` or `cyclonedx-json`
- `POST /api/containers/:id/scan` — trigger on-demand vulnerability scan, signature verification, and SBOM generation

See full configuration in [`docs/configuration/security/README.md`](docs/configuration/security/README.md).

<h2 align="center" id="supported-registries">Supported Registries</h2>

---

<details>
<summary><strong>Public registries</strong> (auto-registered, no config needed)</summary>

| Registry | Provider | URL |
| --- | --- | --- |
| Docker Hub | `hub` | `hub.docker.com` |
| GitHub Container Registry | `ghcr` | `ghcr.io` |
| Google Container Registry | `gcr` | `gcr.io` |
| Quay | `quay` | `quay.io` |
| LinuxServer (LSCR) | `lscr` | `lscr.io` |
| DigitalOcean | `docr` | `registry.digitalocean.com` |
| Codeberg | `codeberg` | `codeberg.org` |
| DHI | `dhi` | `dhi.io` |
| Amazon ECR Public | `ecr` | `public.ecr.aws` |

</details>

<details>
<summary><strong>Private registries</strong> (require credentials)</summary>

| Registry | Provider | Env vars |
| --- | --- | --- |
| Docker Hub | `hub` | `DD_REGISTRY_HUB_{name}_LOGIN`, `_TOKEN` |
| Amazon ECR | `ecr` | `DD_REGISTRY_ECR_{name}_ACCESSKEYID`, `_SECRETACCESSKEY`, `_REGION` |
| Azure ACR | `acr` | `DD_REGISTRY_ACR_{name}_CLIENTID`, `_CLIENTSECRET` |
| GitLab | `gitlab` | `DD_REGISTRY_GITLAB_{name}_TOKEN` |
| GitHub (GHCR) | `ghcr` | `DD_REGISTRY_GHCR_{name}_TOKEN` |
| Gitea / Forgejo | `gitea` | `DD_REGISTRY_GITEA_{name}_LOGIN`, `_PASSWORD` |
| TrueForge | `trueforge` | `DD_REGISTRY_TRUEFORGE_{name}_NAMESPACE`, `_ACCOUNT`, `_TOKEN` |
| Custom (any v2) | `custom` | `DD_REGISTRY_CUSTOM_{name}_URL` + optional auth |

See [Registry docs](docs/configuration/registries/README.md) for full configuration.

</details>

<h2 align="center" id="supported-triggers">Supported Triggers</h2>

---

<details>
<summary><strong>Notification triggers</strong> (16 providers)</summary>

All env vars use the `DD_` prefix; Docker labels use the `dd.` prefix.

| Trigger | Description | Docs |
| --- | --- | --- |
| Apprise | Universal notification gateway | [docs](docs/configuration/triggers/apprise/README.md) |
| Command | Run arbitrary shell commands | [docs](docs/configuration/triggers/command/README.md) |
| Discord | Discord webhook | [docs](docs/configuration/triggers/discord/README.md) |
| Docker | Auto-pull and restart containers | [docs](docs/configuration/triggers/docker/README.md) |
| Docker Compose | Auto-pull and recreate compose services | [docs](docs/configuration/triggers/docker-compose/README.md) |
| Gotify | Gotify push notifications | [docs](docs/configuration/triggers/gotify/README.md) |
| HTTP | Generic webhook (POST) | [docs](docs/configuration/triggers/http/README.md) |
| IFTTT | IFTTT applet trigger | [docs](docs/configuration/triggers/ifttt/README.md) |
| Kafka | Kafka message producer | [docs](docs/configuration/triggers/kafka/README.md) |
| MQTT | MQTT message (Home Assistant compatible) | [docs](docs/configuration/triggers/mqtt/README.md) |
| NTFY | ntfy.sh push notifications | [docs](docs/configuration/triggers/ntfy/README.md) |
| Pushover | Pushover notifications | [docs](docs/configuration/triggers/pushover/README.md) |
| Rocket.Chat | Rocket.Chat webhook | [docs](docs/configuration/triggers/rocketchat/README.md) |
| Slack | Slack webhook | [docs](docs/configuration/triggers/slack/README.md) |
| SMTP | Email notifications | [docs](docs/configuration/triggers/smtp/README.md) |
| Telegram | Telegram bot messages | [docs](docs/configuration/triggers/telegram/README.md) |

All triggers support **threshold filtering** (`all`, `major`, `minor`, `patch`) to control which updates fire notifications.

</details>

<h2 align="center" id="authentication">Authentication</h2>

---

<details>
<summary><strong>Supported auth methods</strong></summary>

| Method | Description | Docs |
| --- | --- | --- |
| Anonymous | No auth (default) | — |
| Basic | Username + password hash | [docs](docs/configuration/authentications/basic/README.md) |
| OIDC | OpenID Connect (Authelia, Auth0, Authentik) | [docs](docs/configuration/authentications/oidc/README.md) |

</details>

<h2 align="center" id="migrating-from-wud">Migrating from WUD</h2>

---

drydock is a drop-in replacement for What's Up Docker (WUD). Switch only the image reference — everything else stays the same:

```diff
- image: getwud/wud:8.1.1
+ image: codeswhat/drydock:latest
```

**Full backwards compatibility is built in.** You do not need to rename anything in your compose file, environment, or labels:

| WUD (legacy) | drydock (new) | Status |
| --- | --- | --- |
| `WUD_` env vars | `DD_` env vars | Both work — `WUD_` vars are automatically mapped to their `DD_` equivalents at startup. If both are set, `DD_` takes priority. |
| `wud.*` container labels | `dd.*` container labels | Both work — all `wud.*` labels (`wud.watch`, `wud.tag.include`, `wud.display.name`, etc.) are recognized alongside their `dd.*` counterparts. |
| `/store/wud.json` state file | `/store/dd.json` state file | Automatic migration — on first start, if `wud.json` exists and `dd.json` does not, drydock renames it in place. No data loss. |
| Session store (connect-loki) | Session store (connect-loki) | Auto-healed — WUD's session data is incompatible (different secret key), but drydock automatically regenerates corrupt sessions instead of failing. No manual cleanup needed. |
| Docker socket mount | Docker socket mount | Unchanged — same `/var/run/docker.sock` bind mount. |
| Health endpoint `/health` | Health endpoint `/health` | Unchanged — same path, same port (default 3000). |

**In short:** swap the image, restart the container, done. Your watchers, triggers, registries, and authentication config all carry over with zero changes.

<details>
<summary><strong>Feature comparison</strong></summary>

> For the full itemized changelog, see [CHANGELOG.md](CHANGELOG.md).

<table>
<thead>
<tr>
<th width="28%">Feature</th>
<th width="14%" align="center">drydock</th>
<th width="16%" align="center">Watchtower</th>
<th width="14%" align="center">WUD</th>
<th width="14%" align="center">Diun</th>
<th width="14%" align="center">Ouroboros</th>
</tr>
</thead>
<tbody>
<tr><td>Web UI / Dashboard</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Auto-update containers</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>Docker Compose updates</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Notification triggers</td><td align="center">16</td><td align="center">~18 (Shoutrrr)</td><td align="center">14</td><td align="center">17</td><td align="center">~6</td></tr>
<tr><td>Registry providers</td><td align="center">15</td><td align="center">⚠️ (Docker auth)</td><td align="center">8</td><td align="center">⚠️ (regopts)</td><td align="center">⚠️ (Docker auth)</td></tr>
<tr><td>OIDC / SSO authentication</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>REST API</td><td align="center">✅</td><td align="center">⚠️ (limited)</td><td align="center">✅</td><td align="center">⚠️ (gRPC)</td><td align="center">❌</td></tr>
<tr><td>Prometheus metrics</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Image backup & rollback</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container grouping / stacks</td><td align="center">✅</td><td align="center">⚠️ (linked)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Lifecycle hooks (pre/post)</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Webhook API for CI/CD</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container start/stop/restart/update</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Distributed agents (remote)</td><td align="center">✅</td><td align="center">⚠️ (single host)</td><td align="center">❌</td><td align="center">✅ (multi-orch)</td><td align="center">❌</td></tr>
<tr><td>Audit log</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Security scanning (Trivy)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Semver-aware updates</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Digest watching</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Multi-arch (amd64/arm64)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Actively maintained</td><td align="center">✅</td><td align="center">❌ (archived)</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌ (dead)</td></tr>
</tbody>
</table>

> Data based on publicly available documentation as of February 2026.
> Contributions welcome if any information is inaccurate.

</details>

<details>
<summary><strong>Additional features over WUD</strong></summary>

| Feature | Description |
| --- | --- |
| **Agent mode** | Distributed monitoring with remote agents over SSE |
| **OIDC token lifecycle** | Bearer/Basic auth for remote watcher HTTPS connections |
| **Container update policy** | Skip/snooze specific versions per container via API and UI |
| **Metrics auth toggle** | `DD_SERVER_METRICS_AUTH=false` to expose `/metrics` without auth |
| **Trust proxy config** | `DD_SERVER_TRUSTPROXY` — set to `1` (hop count) behind a reverse proxy, or `false` (default) for direct exposure |
| **NTFY provider-level threshold** | Set threshold at the ntfy provider level, not just per-trigger |
| **Docker pull progress logging** | Rate-limited pull progress during compose updates |
| **Registry lookup image override** | `lookupImage` field to override tag lookup image |
| **DHI registry** | `dhi.io` registry provider |
| **Custom URL icons** | URL-based icons via `dd.display.icon` label |
| **Version skip UI** | Skip specific versions from the web interface |
| **In-app log viewer** | View container stdout/stderr logs and application runtime logs with level filtering and agent source selection |
| **Semver tag recovery** | Recover mismatched semver tags from include filters |
| **Per-image config presets** | `imgset` defaults for per-image configuration |
| **Audit log** | Event-based audit trail with LokiJS storage, REST API, and Prometheus counter |
| **Dry-run preview** | Preview what a container update would do without performing it |
| **Image backup & rollback** | Automatic pre-update image backup with configurable retention and rollback API |
| **Grafana dashboard** | Importable JSON template for Prometheus metrics overview |
| **Update Guard** | Safe-pull gate for Docker updates: Trivy vulnerability scan + optional cosign signature verification + SBOM generation + on-demand scan from UI/API |
| **Font Awesome 6 icons** | Migrated from MDI to FA6 with support for `fab:`/`far:`/`fas:` prefix syntax |
| **Icon CDN** | Auto-resolve container icons via selfhst/icons (`sh-` prefix) with homarr-labs fallback, plus `hl-`/`si-` and custom URL support |
| **Mobile responsive UI** | Optimized mobile breakpoints for dashboard, containers, and self-update overlay |
| **Container actions** | Start/stop/restart/update containers via API and UI, gated by `DD_SERVER_FEATURE_CONTAINERACTIONS` |
| **Webhook API** | Token-authenticated HTTP endpoints for CI/CD integration to trigger watch cycles and updates, gated by `DD_SERVER_WEBHOOK_ENABLED` and `DD_SERVER_WEBHOOK_TOKEN` |
| **Lifecycle hooks** | Pre/post-update shell command hooks with configurable timeout |
| **Auto rollback on health failure** | Monitors container health after updates and rolls back if unhealthy, configured via `dd.rollback.auto=true` |
| **Graceful self-update** | Full-screen animated overlay during drydock's own container update with SSE-based reconnect |
| **Container grouping / stacks** | Smart stack detection via `dd.group` label or compose project, with collapsible UI groups and batch-update |

</details>

<details>
<summary><strong>Bug fixes over WUD</strong></summary>

| Fix | Impact |
| --- | --- |
| `eval()` code injection | Replaced with safe `String.replace()` interpolation |
| OIDC session state races | Serialized redirect checks, multiple pending states |
| OIDC session resilience | Auto-regenerates corrupt sessions from WUD migration, JSON error responses |
| Docker event stream crash | Buffered split payloads before JSON parse |
| Multi-network container recreate | Reconnects additional networks after recreation |
| docker-compose post_start hooks | Hooks now execute after updates |
| Express 5 wildcard routes | Named wildcard params for Express 5 compat |

</details>

<details>
<summary><strong>Tech stack comparison</strong></summary>

| | WUD | drydock |
| --- | --- | --- |
| **Language** | JavaScript | TypeScript (ESM, `NodeNext`) |
| **Test runner** | Jest | Vitest 4 |
| **Linter** | ESLint + Prettier | Biome |
| **Express** | 4.x | 5.x |
| **Build system** | Babel | `tsc` (no transpiler) |

</details>

<h2 align="center" id="roadmap">Roadmap</h2>

---

Here's what's coming.

| Version | Theme | Highlights |
| --- | --- | --- |
| **v1.3.0** ✅ | Security Integration | Trivy scanning, Update Guard, SBOM generation, image signing, on-demand scan |
| **v1.4.0** | UI Modernization | PrimeVue migration, Composition API, Vite cleanup, font personalization |
| **v1.5.0** | Observability | Real-time log viewer, resource monitoring, registry webhooks, notification templates, release notes, MS Teams & Matrix |
| **v1.6.0** | Fleet Management | YAML config, live UI config panels, volume browser, parallel updates, dependency ordering, container groups |
| **v2.0.0** | Platform Expansion | Docker Swarm, Kubernetes watchers and triggers |
| **v2.1.0** | Deployment Patterns | Health check gates, canary deployments |
| **v2.2.0** | Container Operations | Web terminal, file browser, image building |
| **v2.3.0** | Developer Experience | API keys, passkey auth, TOTP 2FA, OpenAPI docs, TypeScript actions, CLI |
| **v2.4.0** | Data Safety | Scheduled backups (S3, SFTP), compose templates, secret management |
| **v3.0.0** | GitOps & Beyond | Git-based stack deployment, network topology, GPU monitoring, i18n |

<h2 align="center" id="documentation">Documentation</h2>

---

| Resource | Link |
| --- | --- |
| Website | [drydock.codeswhat.com](https://drydock.codeswhat.com/) |
| Docs | [`docs/README.md`](docs/README.md) |
| Configuration | [`docs/configuration/README.md`](docs/configuration/README.md) |
| Quick Start | [`docs/quickstart/README.md`](docs/quickstart/README.md) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) |
| Roadmap | See [Roadmap](#roadmap) section above |
| Issues | [GitHub Issues](https://github.com/CodesWhat/drydock/issues) |
| Discussions | [GitHub Discussions](https://github.com/CodesWhat/drydock/discussions) — feature requests & ideas welcome |

<h2 align="center" id="star-history">Star History</h2>

---

<div align="center">
  <a href="https://www.star-history.com/#CodesWhat/drydock&type=timeline&legend=top-left">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&theme=dark&legend=top-left" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&legend=top-left" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=CodesWhat/drydock&type=timeline&legend=top-left" />
    </picture>
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
[![Biome](https://img.shields.io/badge/Biome_2.3-60a5fa?logo=biome&logoColor=fff)](https://biomejs.dev/)
[![Node 24](https://img.shields.io/badge/Node_24_Alpine-339933?logo=nodedotjs&logoColor=fff)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=fff)](https://www.docker.com/)
[![Built with AI](https://img.shields.io/badge/Built_with_AI-000000?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/)

---

**[MIT License](LICENSE)**

<a href="https://github.com/CodesWhat"><img src="docs/assets/codeswhat-logo-original.svg" alt="CodesWhat" height="28"></a>

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/J3J21HQM0K)

<a href="#drydock">Back to top</a>

</div>
