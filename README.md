<div align="center">

<img src="docs/assets/whale-logo.png" alt="drydock" width="220">

<h1>drydock</h1>

**Open source container update monitoring — built in TypeScript with modern tooling.**

</div>

<p align="center">
  <a href="https://github.com/CodesWhat/drydock/releases"><img src="https://img.shields.io/badge/version-1.4.0-blue" alt="Version"></a>
  <a href="https://github.com/CodesWhat/drydock/pkgs/container/drydock"><img src="https://img.shields.io/badge/GHCR-20K%2B_pulls-2ea44f?logo=github&logoColor=white" alt="GHCR pulls"></a>
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

<hr>

<h2 align="center">📑 Contents</h2>

- [📖 Documentation](https://drydock.codeswhat.com/docs)
- [🚀 Quick Start](#quick-start)
- [📸 Screenshots](#screenshots)
- [🖥️ UI Workflow](#ui-workflow)
- [✨ Features](#features)
- [🥊 Update Bouncer](#update-bouncer)
- [📦 Supported Registries](#supported-registries)
- [🔔 Supported Triggers](#supported-triggers)
- [🔐 Authentication](#authentication)
- [⚖️ Feature Comparison](#feature-comparison)
- [🔄 Migration](#migration)
- [🗺️ Roadmap](#roadmap)
- [📖 Documentation](#documentation)
- [⭐ Star History](#star-history)
- [Built With](#built-with)

<hr>

<h2 align="center" id="quick-start">🚀 Quick Start</h2>

```bash
docker run -d \
  --name drydock \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  codeswhat/drydock:latest
```

The image includes `trivy` and `cosign` binaries for local vulnerability scanning and image verification.

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
<summary><strong>Docker socket access (secure-first)</strong></summary>

`drydock` needs Docker API access to monitor/update containers.

- Recommended: use a socket proxy and point Drydock to it (`DD_WATCHER_DOCKER_SOCKET=tcp://dockerproxy:2375`).
- Direct socket mounts are supported, but root mode is break-glass only.

If you must use break-glass root mode, set both flags explicitly:

```yaml
environment:
  - DD_RUN_AS_ROOT=true
  - DD_ALLOW_INSECURE_ROOT=true
```

If `DD_RUN_AS_ROOT=true` is set without `DD_ALLOW_INSECURE_ROOT=true`, startup now fails closed by design.

See the docs for full guidance:

- [Docker Socket Security](https://drydock.codeswhat.com/docs/configuration/watchers/#docker-socket-security)
- [Docker Compose Trigger Permissions](https://drydock.codeswhat.com/docs/configuration/triggers/docker-compose/#permissions-and-compose-cli-access)

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

<hr>

<h2 align="center" id="screenshots">📸 Screenshots</h2>

<!-- TODO: Capture fresh v1.4 screenshots before release (login, dashboard, containers, container detail — light/dark + mobile) -->

<h3 align="center" id="ui-workflow">🖥️ UI Workflow (v1.4 Finish-Off)</h3>

- **Global command palette (`Cmd/Ctrl+K`)** — Search pages, containers, agents, triggers, watchers, registries, auth, and notification rules from one place.
- **Prefix scopes** — Use `/` for pages, `@` for runtime resources, and `#` for config/settings search.
- **Recent-first navigation** — Empty query shows recent results to speed up repeat actions.
- **Container-aware visuals** — Container search rows render resolved image icons instead of generic placeholders.
- **Notifications as active control plane** — `/notifications` now edits per-event rules and trigger assignments that directly gate runtime dispatch.
- **Dashboard layout persistence** — Drag/drop dashboard widgets to reorder; layout persists locally with a reset option.
- **Profile/runtime status clarity** — Config profile/server/settings panels include explicit loading, error, and refresh flows.
- **Keyboard flow polish** — Confirm dialogs support `Enter`/`Escape`; detail panels close with `Escape`.

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
Auto-pull and recreate services via docker-compose with service-scoped compose image patching
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

<h2 align="center" id="update-bouncer">🥊 Update Bouncer</h2>

<details>
<summary><strong>Trivy-powered safe-pull gate for container updates</strong></summary>

1. Scan the candidate image before pull/restart
2. Block the update when vulnerabilities exceed configured severity threshold
3. Verify candidate image signatures with cosign (optional block gate)
4. Generate SBOM documents (`spdx-json`, `cyclonedx-json`) for candidate images
5. Persist security state to `container.security.{scan,signature,sbom}` for API/UI visibility

Security scanning is disabled by default and is enabled with `DD_SECURITY_SCANNER=trivy`.

> The image includes both `trivy` and `cosign` for local CLI mode. Trivy server mode is also supported via `DD_SECURITY_TRIVY_SERVER`.

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

</details>

<hr>

<h2 align="center" id="supported-registries">📦 Supported Registries</h2>

<details>
<summary><strong>Public registries</strong> (auto-registered, no config needed)</summary>

| Registry | Provider | URL |
| --- | --- | --- |
| Docker Hub | `hub` | `hub.docker.com` |
| GitHub Container Registry | `ghcr` | `ghcr.io` |
| Google Container Registry | `gcr` | `gcr.io` |
| Google Artifact Registry | `gar` | `*-docker.pkg.dev` |
| Quay | `quay` | `quay.io` |
| LinuxServer (LSCR) | `lscr` | `lscr.io` |
| DigitalOcean | `docr` | `registry.digitalocean.com` |
| Codeberg | `codeberg` | `codeberg.org` |
| DHI | `dhi` | `dhi.io` |
| Amazon ECR Public | `ecr` | `public.ecr.aws` |
| IBM Cloud | `ibmcr` | `*.icr.io` |
| Oracle Cloud (OCIR) | `ocir` | `*.ocir.io` |
| Alibaba Cloud (ALICR) | `alicr` | `*.aliyuncs.com` |

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
| Gitea / Forgejo | `gitea` | `DD_REGISTRY_GITEA_{name}_URL`, `_LOGIN`, `_PASSWORD` + optional `_CAFILE`, `_INSECURE` |
| Harbor | `harbor` | `DD_REGISTRY_HARBOR_{name}_URL`, `_LOGIN`, `_PASSWORD` + optional `_CAFILE`, `_INSECURE` |
| JFrog Artifactory | `artifactory` | `DD_REGISTRY_ARTIFACTORY_{name}_URL`, `_LOGIN`, `_PASSWORD` + optional `_CAFILE`, `_INSECURE` |
| Sonatype Nexus | `nexus` | `DD_REGISTRY_NEXUS_{name}_URL`, `_LOGIN`, `_PASSWORD` + optional `_CAFILE`, `_INSECURE` |
| TrueForge | `trueforge` | `DD_REGISTRY_TRUEFORGE_{name}_NAMESPACE`, `_ACCOUNT`, `_TOKEN` |
| Custom (any v2) | `custom` | `DD_REGISTRY_CUSTOM_{name}_URL` + optional auth, `_CAFILE`, `_INSECURE` |

See the [documentation](https://drydock.codeswhat.com/docs/configuration/registries) for full configuration.
For self-hosted registries, prefer `CAFILE` to trust internal CAs; use `INSECURE=true` only as a fallback on trusted internal networks.

</details>

<hr>

<h2 align="center" id="supported-triggers">🔔 Supported Triggers</h2>

<details>
<summary><strong>Notification triggers</strong> (20 providers)</summary>

All env vars use the `DD_` prefix; Docker labels use the `dd.` prefix.

| Trigger | Description |
| --- | --- |
| Apprise | Universal notification gateway |
| Command | Run arbitrary shell commands |
| Discord | Discord webhook |
| Docker | Auto-pull and restart containers |
| Docker Compose | Auto-pull and recreate compose services |
| Google Chat | Google Chat incoming webhook |
| Gotify | Gotify push notifications |
| HTTP | Generic webhook (POST) |
| IFTTT | IFTTT applet trigger |
| Kafka | Kafka message producer |
| Matrix | Matrix room notifications |
| Mattermost | Mattermost incoming webhook |
| MQTT | MQTT message (Home Assistant compatible) |
| MS Teams | Microsoft Teams webhook (Adaptive Cards) |
| NTFY | ntfy.sh push notifications |
| Pushover | Pushover notifications |
| Rocket.Chat | Rocket.Chat webhook |
| Slack | Slack webhook |
| SMTP | Email notifications |
| Telegram | Telegram bot messages |

All triggers support **threshold filtering** (`all`, `major`, `minor`, `patch`) to control which updates fire notifications.

</details>

<hr>

<h2 align="center" id="authentication">🔐 Authentication</h2>

<details>
<summary><strong>Supported auth methods</strong></summary>

| Method | Description | Docs |
| --- | --- | --- |
| Anonymous | No auth (default) | — |
| Basic | Username + password hash | [docs](docs/configuration/authentications/basic/README.md) |
| OIDC | OpenID Connect (Authelia, Auth0, Authentik) | [docs](docs/configuration/authentications/oidc/README.md) |

</details>

<details>
<summary><strong>Auth hardening defaults (fail-closed)</strong></summary>

As of 2026 hardening updates, auth-related remote flows now fail closed by default:

- **Remote Docker watcher auth** fails when credentials are incomplete, auth type is unsupported, or HTTPS/TLS is missing.
  - Break-glass override is explicit: `DD_WATCHER_{watcher_name}_AUTH_INSECURE=true`
- **Registry bearer token exchange** fails when token endpoints error or return no token (no silent anonymous fallback).
- **Hub/DHI public legacy token-auth migration path** keeps startup non-breaking for partial/mixed `DD_REGISTRY_{HUB|DHI}_PUBLIC_*` credentials by falling back to anonymous `hub.public` / `dhi.public` with startup warnings. This compatibility fallback is deprecated and will be removed in a future major release.
- **HTTP trigger auth** fails when `AUTH_TYPE` is unsupported or required `BASIC`/`BEARER` values are missing.

See:

- [Watcher auth configuration](https://drydock.codeswhat.com/docs/configuration/watchers)
- [HTTP trigger configuration](https://drydock.codeswhat.com/docs/configuration/triggers/http)
- [Registry configuration](https://drydock.codeswhat.com/docs/configuration/registries)

</details>

<details>
<summary><strong>OIDC session cookie policy (SameSite)</strong></summary>

For OIDC providers hosted on a different domain (Auth0, Authentik, Authelia, etc.), drydock defaults to:

- `DD_SERVER_COOKIE_SAMESITE=lax`

This keeps login callbacks compatible while still reducing CSRF risk for normal cross-site requests.

You can override with:

- `DD_SERVER_COOKIE_SAMESITE=strict` for fully same-site deployments
- `DD_SERVER_COOKIE_SAMESITE=none` for fully cross-site/embed scenarios (HTTPS required; drydock forces `Secure` cookies automatically)

If OIDC callback logs or UI errors show "OIDC session is missing or expired", verify this setting first.

</details>

<hr>

<h2 align="center" id="migration">🔄 Migration</h2>

<details>
<summary><strong>What's Up Docker (WUD) — Drop-in replacement</strong></summary>

drydock is a drop-in replacement for What's Up Docker (WUD). Switch only the image reference — everything else stays the same:

```diff
- image: getwud/wud:8.1.1
+ image: codeswhat/drydock:latest
```

**Full backwards compatibility is built in.** You do not need to rename anything in your compose file, environment, or labels:

| WUD (legacy) | drydock (new) | Status |
| --- | --- | --- |
| `WUD_` env vars | `DD_` env vars | Both work — `WUD_` vars are automatically mapped to their `DD_` equivalents at startup. If both are set, `DD_` takes priority. |
| `wud.*` container labels | `dd.*` container labels | Both work for legacy-equivalent settings — core `wud.*` labels (`wud.watch`, `wud.tag.include`, `wud.display.name`, etc.) are recognized alongside `dd.*`; newer drydock-only labels are `dd.*` only. |
| `/store/wud.json` state file | `/store/dd.json` state file | Automatic migration — on first start, if `wud.json` exists and `dd.json` does not, drydock renames it in place. No data loss. |
| Session store (connect-loki) | Session store (connect-loki) | Auto-healed — WUD's session data is incompatible (different secret key), but drydock automatically regenerates corrupt sessions instead of failing. No manual cleanup needed. |
| Docker socket mount | Docker socket mount | Unchanged — same `/var/run/docker.sock` bind mount. |
| Health endpoint `/health` | Health endpoint `/health` | Unchanged — same path, same port (default 3000). |

**In short:** swap the image, restart the container, done. Your watchers, triggers, registries, and authentication config all carry over with zero changes.

If you want to rewrite existing config files to the drydock naming convention in one pass, use:

```bash
# from the app directory
node dist/index.js config migrate --dry-run
node dist/index.js config migrate --file .env --file compose.yaml
```

For containerized installs:

```bash
docker exec -it <drydock-container> node dist/index.js config migrate --dry-run
```

`config migrate` only reads and updates your local config files. It does not call home or send usage data to external services.

</details>

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
<tr><td>Notification triggers</td><td align="center">20</td><td align="center">~19</td><td align="center">16</td><td align="center">17</td><td align="center">~6</td></tr>
<tr><td>Registry providers</td><td align="center">23</td><td align="center">⚠️</td><td align="center">13</td><td align="center">⚠️</td><td align="center">⚠️</td></tr>
<tr><td>OIDC / SSO authentication</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>REST API</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td></tr>
<tr><td>Prometheus metrics</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td></tr>
<tr><td>MQTT / Home Assistant</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Image backup & rollback</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container grouping / stacks</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Lifecycle hooks (pre/post)</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Webhook API for CI/CD</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Container start/stop/restart/update</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Distributed agents (remote)</td><td align="center">✅</td><td align="center">⚠️</td><td align="center">❌</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Audit log</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Security scanning (Trivy)</td><td align="center">✅</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td><td align="center">❌</td></tr>
<tr><td>Semver-aware updates</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
<tr><td>Digest watching</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Multi-arch (amd64/arm64)</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td><td align="center">✅</td></tr>
<tr><td>Actively maintained</td><td align="center">✅</td><td align="center">❌</td><td align="center">✅</td><td align="center">✅</td><td align="center">❌</td></tr>
</tbody>
</table>

> Data based on publicly available documentation as of February 2026.
> Contributions welcome if any information is inaccurate.

</details>

<hr>

<h2 align="center" id="roadmap">🗺️ Roadmap</h2>

Here's what's coming. WUD `WUD_*` env vars and `wud.*` labels remain fully supported at runtime — see [🔄 Migration](#migration) for details.

| Version | Theme | Highlights |
| --- | --- | --- |
| **v1.3.x** ✅ | Security & Stability | Trivy scanning, Update Bouncer, SBOM, 7 new registries, 4 new triggers, self-update fix, rollback fixes, GHCR auth fix, self-hosted TLS options, re2-wasm → re2js regex engine swap, compose trigger fixes, DB persistence on shutdown, CI caching + pipeline hardening, biome → qlty lint migration |
| **v1.4.0** ✅ | UI Modernization | Tailwind CSS 4 migration with custom component library, 4 color themes (Drydock/GitHub/Dracula/Catppuccin), 7 icon libraries, 6 font families, shared data components (DataTable/DataCardGrid/DataListAccordion/DataFilterBar/DetailPanel/EmptyState), settings backend + icon proxy cache, container ghost state during updates, SSE real-time updates, remember-me auth |
| **v1.4.1** | Reliability & Resilience | Non-self rollback, event-stream reconnect, CSRF, error sanitization, UI resilience |
| **v1.5.0** | Observability | Real-time log viewer, container resource monitoring, registry webhooks |
| **v1.5.1** | Scanner Decoupling | Backend-based scanner execution (docker/remote), Grype provider, scanner asset lifecycle |
| **v1.6.0** | Notifications & Release Intel | Notification templates, release notes in notifications, MS Teams & Matrix triggers |
| **v1.7.0** | Smart Updates & UX | Dependency-aware ordering, clickable port links, image prune, static image monitoring, dashboard customization |
| **v1.8.0** | Fleet Management & Live Config | YAML config, live UI config panels, volume browser, parallel updates, SQLite store migration, i18n framework |
| **v2.0.0** | Platform Expansion | Docker Swarm, Kubernetes watchers and triggers, basic GitOps |
| **v2.1.0** | Advanced Deployment Patterns | Health check gates, canary deployments, durable self-update controller |
| **v2.2.0** | Container Operations | Web terminal, file browser, image building, basic Podman support |
| **v2.3.0** | Automation & Developer Experience | API keys, passkey auth, TOTP 2FA, OpenAPI docs, TypeScript actions, CLI |
| **v2.4.0** | Data Safety & Templates | Scheduled backups (S3, SFTP), compose templates, secret management |
| **v3.0.0** | Advanced Platform | Network topology, GPU monitoring, full i18n translations |
| **v3.1.0** | Enterprise Access & Compliance | RBAC, LDAP/AD, environment-scoped permissions, audit logging, Wolfi hardened image |

<hr>

<h2 align="center" id="documentation">📖 Documentation</h2>

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

<hr>

<a id="star-history"></a>

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

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=kofi&logoColor=white)](https://ko-fi.com/codeswhat)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/codeswhat)
[![Sponsor](https://img.shields.io/badge/Sponsor-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/CodesWhat)

<a href="#drydock">Back to top</a>

</div>
