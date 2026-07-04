# Deprecations

Active deprecations and their removal timeline. Each entry includes the version it was deprecated, the version it will be removed, and migration guidance.

**API versioning policy:** `/api/v1` is the frozen, canonical API contract. Breaking response-shape changes are never made to `/api/v1` — they only ever land as a new `/api/v2`. The unversioned `/api` alias is removed in v1.6.0. The flag-gated wud-card compatibility endpoints (see the Unversioned `/api/*` path entry below) are the sole exception and continue to be served after that removal.

## Active

### HTTP OIDC Discovery URLs

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_AUTH_OIDC_*_DISCOVERY` values using `http://` |

OIDC providers configured with an `http://` discovery URL trigger `allowInsecureRequests` in the openid-client library. This workaround is deprecated.

**Migration:** Update your Identity Provider to serve its OIDC discovery endpoint over HTTPS, then update your `DD_AUTH_OIDC_<name>_DISCOVERY` environment variable to the `https://` URL.

---

### Legacy Basic Auth Password Hashes

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_AUTH_BASIC_*_HASH` values using `{SHA}`, `$apr1$`/`$1$` (MD5), `crypt`, or plain-text formats |

Legacy password hash formats inherited from the upstream WUD project (`{SHA}`, APR1/MD5, crypt, and plain-text) are accepted with deprecation warnings. These formats are cryptographically weak and unsuitable for password hashing.

**Migration:** Generate a new argon2id hash using the Drydock container and update your `DD_AUTH_BASIC_<name>_HASH` environment variable:

```bash
docker run --rm codeswhat/drydock node -e '
  const c = require("node:crypto");
  const s = c.randomBytes(32);
  const h = c.argon2Sync("argon2id", { message: process.argv[1], nonce: s, memory: 65536, passes: 3, parallelism: 4, tagLength: 64 });
  console.log("argon2id$65536$3$4$" + s.toString("base64") + "$" + h.toString("base64"));
' "YOUR_PASSWORD_HERE"
```

---

### PUT /api/settings

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | API consumers using `PUT /api/settings` |

`PUT /api/settings` is a compatibility alias for `PATCH /api/settings`. Use `PATCH` for partial settings updates.

**Migration:** Replace `PUT /api/settings` calls with `PATCH /api/settings`.

---

### Unversioned `/api/*` path

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | API consumers using `/api/...` instead of `/api/v1/...` |

`/api/*` is a backward-compatible alias for `/api/v1/*`. The alias will be removed in v1.6.0.

**Migration:** Update all API calls to use the `/api/v1/` prefix (e.g., `/api/v1/containers` instead of `/api/containers`).

**Exception:** the opt-in wud-card compatibility endpoints (`DD_COMPAT_WUDCARD`, default `false`) remain mounted at `/api/*` after the alias removal — the compat router serves its four whitelisted routes off its own internal API router instance rather than by falling through to the deprecated `/api` alias, so removing the alias does not affect them. They exist solely to keep the Home Assistant [wud-card](https://github.com/angryvoegi/wud-card) integration (and Homepage's native `whatsupdocker` widget, which expects the same bare-array shape) working, are off by default, and are best-effort with no compatibility guarantee — see [Server configuration](https://getdrydock.com/docs/configuration/server) for details.

---

### Unversioned `GET /api/auth/methods` alias

| | |
| --- | --- |
| **Deprecated in** | v1.6.0 |
| **Removed in** | v1.7.0 |
| **Affects** | API consumers using `GET /api/auth/methods` |

`GET /api/auth/methods` is a legacy, unversioned alias for `GET /auth/strategies` (`app/api/auth.ts`), kept unauthenticated so the login screen can render before a session exists. It logs a deprecation warning on each request: "GET /api/auth/methods is deprecated and will be removed in v1.7.0. Use GET /auth/strategies instead."

**Migration:** Replace `GET /api/auth/methods` with `GET /auth/strategies`.

---

### Legacy auth strategies response shape (`GET /auth/strategies`)

| | |
| --- | --- |
| **Deprecated in** | v1.6.0 |
| **Removed in** | v1.8.0 |
| **Affects** | Clients reading `{ strategies, warnings }` from `GET /auth/strategies` |

`GET /auth/strategies` returns the older `{ strategies, warnings }` response shape. The canonical replacement, `GET /api/v1/auth/status` (also available at `/api/auth/status` and `/auth/status`), returns `{ providers, errors }` — the same provider list plus structured startup registration errors instead of ad hoc warning strings. Its unversioned alias, `GET /api/auth/methods` (see above), is deprecated on a separate, earlier timeline and is removed outright in v1.7.0, ahead of this response-shape migration deadline. Unlike other entries in this file, `GET /auth/strategies` currently emits no deprecation signal for its response shape — no log warning, no `Deprecation`/`Sunset` header, no Prometheus counter, no UI banner — so usage is invisible until removal.

**Migration:** Read `providers`/`errors` from `GET /api/v1/auth/status` instead of `strategies`/`warnings` from `GET /auth/strategies`.

---

### Legacy `wud.*` Docker labels

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Containers using `wud.*` labels (e.g., `wud.watch`, `wud.tag.include`) |

Legacy `wud.*` labels from the upstream WUD project are accepted as fallbacks for their `dd.*` equivalents. Each fallback logs a deprecation warning on first use.

**Migration:** Rename all `wud.*` labels to `dd.*` on your containers (e.g., `wud.watch=true` becomes `dd.watch=true`). Use `node dist/index.js config migrate` to automate the conversion across compose files and `.env` files.

---

### Legacy `WUD_*` environment variables

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Configurations using `WUD_*` env vars (e.g., `WUD_AGENT_SECRET`) |

Legacy `WUD_*` environment variables are accepted as fallbacks for their `DD_*` equivalents. Usage is tracked via the `dd_legacy_input_total` Prometheus counter.

**Migration:** Rename all `WUD_*` environment variables to `DD_*` (e.g., `WUD_AGENT_SECRET` becomes `DD_AGENT_SECRET`). Use `node dist/index.js config migrate` for automated conversion.

---

### Manual updates bypass `dd.action.include` / `dd.action.exclude` (and legacy `dd.trigger.include` / `dd.trigger.exclude`)

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.7.0 |
| **Affects** | Containers labeled with `dd.action.include` / `dd.action.exclude` (or the legacy `dd.trigger.include` / `dd.trigger.exclude`) where the labels filter out the matching docker / dockercompose action trigger |

In v1.5.x the eligibility model classifies `trigger-not-included` and `trigger-excluded` as **soft** blockers: the row pill says *Trigger filtered* / *Trigger excluded*, but clicking the per-row Update button still queues the update (the confirm modal lists the soft blocker and switches the accept label to *Update anyway*). This preserves the pre-v1.5 behavior where include/exclude was an *auto-trigger* filter only — manual click bypassed it.

In v1.7.0 these reasons become **hard** blockers: the Update button is locked when the labels filter out the action trigger, and the API rejects manual updates with the blocker's message. The labels then mean what the pill says: *this trigger does not handle this container*.

**Migration:** If you currently rely on manual updates running through a trigger that the container's labels exclude, either (a) remove the `dd.action.exclude` / legacy `dd.trigger.exclude` label from the container, (b) add the trigger to the container's `dd.action.include` / legacy `dd.trigger.include` list, or (c) configure a separate action trigger that the labels permit. The eligibility pill on the row tells you exactly which trigger / label combination is in conflict.

---

### `curl` in Docker image

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.7.0 |
| **Affects** | Custom `healthcheck:` overrides in compose files that use `curl` |

The official Docker image keeps `curl` available in v1.5.x and v1.6.x for backward compatibility with custom healthcheck overrides. The default built-in `HEALTHCHECK` uses the lightweight static binary (`/bin/healthcheck`) instead.

**Migration:** Custom `curl`-based healthcheck overrides remain supported in v1.5.x. v1.6.0 is the final warning release. Removal is scheduled for v1.7.0. Prefer the built-in image healthcheck, or switch custom intervals to `test: /bin/healthcheck ${DD_SERVER_PORT:-3000}`. See [Monitoring](https://getdrydock.com/docs/monitoring).

---

### Legacy trigger prefix inputs (`DD_TRIGGER_*`, `dd.trigger.*`)

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.7.0 |
| **Affects** | Trigger configs using `DD_TRIGGER_*` env vars and container labels `dd.trigger.include` / `dd.trigger.exclude` |

Legacy trigger prefixes are accepted as compatibility aliases while the trigger taxonomy moves to action/notification prefixes.

**Migration:** Prefer `DD_ACTION_*` / `DD_NOTIFICATION_*` and `dd.action.*` / `dd.notification.*`.

The migration CLI can rewrite legacy trigger prefixes for you:

```bash
# Preview changes
node dist/index.js config migrate --source trigger --dry-run

# Apply to specific files
node dist/index.js config migrate --source trigger --file .env --file compose.yaml
```

The CLI rewrites legacy trigger keys to action-prefixed aliases by default (`DD_ACTION_*`, `dd.action.*`), which remain fully compatible.

---

### `DD_WATCHER_{name}_WATCHDIGEST` environment variable

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Configurations using `DD_WATCHER_{name}_WATCHDIGEST` |

The `WATCHDIGEST` env var is deprecated. Use the `dd.watch.digest=true` container label for per-container digest watching instead.

**Migration:** Remove `DD_WATCHER_{name}_WATCHDIGEST` from your environment and add `dd.watch.digest=true` as a label on individual containers that need digest-level monitoring.

---

### `DD_WATCHER_{name}_WATCHATSTART` environment variable

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Configurations using `DD_WATCHER_{name}_WATCHATSTART` |

The `WATCHATSTART` env var is deprecated. Drydock watches at startup by default.

**Migration:** Remove `DD_WATCHER_{name}_WATCHATSTART` from your environment. If you need to delay the first scan, use `DD_WATCHER_{name}_CRON` to control the schedule.

---

### Legacy trigger template variables

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Trigger templates using `$id`, `$name`, `$watcher`, `$kind`, `$semver`, `$local`, `$remote`, `$link`, `$count`, `$raw` |

Several trigger template variable names have been replaced with more descriptive equivalents. The old names are retained as aliases.

**Migration:** Update trigger templates to use the new variable names. See the [trigger configuration docs](https://getdrydock.com/docs/configuration/triggers) for the full variable reference.

---

### Kafka trigger `clientId` configuration key

| | |
| --- | --- |
| **Deprecated in** | v1.4.5 |
| **Removed in** | v1.6.0 |
| **Affects** | Kafka trigger configurations using `clientId` |

Kafka trigger configuration now uses `clientid` (lowercase) as the canonical key. The legacy `clientId` key is accepted as a compatibility alias and logs a deprecation warning.

**Migration:** Rename Kafka trigger config key `clientId` to `clientid`.

---

### Registry `PUBLIC_TOKEN` configuration

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_REGISTRY_HUB_PUBLIC_TOKEN`, `DD_REGISTRY_DHI_PUBLIC_TOKEN`, and similar token-auth env vars |

Token-based authentication for public registries has been replaced by password-based authentication for consistency.

**Migration:** Replace `DD_REGISTRY_HUB_PUBLIC_TOKEN` with `DD_REGISTRY_HUB_PUBLIC_PASSWORD`. Replace `DD_REGISTRY_DHI_PUBLIC_TOKEN` with `DD_REGISTRY_DHI_PUBLIC_PASSWORD`. Both registries require the instance-name segment (`PUBLIC` in these examples) between the provider and the credential key.

---

### Agent-less Home Assistant MQTT topic layout (multi-agent)

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Default flips in** | v1.7.0 |
| **Affects** | Multi-agent deployments using the Home Assistant MQTT integration (`DD_NOTIFICATION_MQTT_<name>_HASS_ENABLED=true`) where more than one node uses the default watcher name `local` |

The current Home Assistant MQTT topic layout (`<topic>/<watcher>/<container>` and the watcher-level sensor topics) has no agent segment. In a multi-agent deployment where the controller and one or more agents all use the default watcher name `local`, two containers with the same name on different agents publish to — and overwrite — the same MQTT topic, watcher running-status topics collide, and the watcher-level sensor counts sum across all agents. This is the Home Assistant facet of [#386](https://github.com/CodesWhat/drydock/issues/386).

Setting `DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT=true` opts into the corrected layout: an `agent/<name>` segment is inserted into every Home Assistant topic for containers owned by a remote agent, watcher running-status topics and watcher-level sensor counts are scoped per agent, and discovery-entity cleanup is scoped per agent. Controller-local container topics are unchanged whether or not the flag is set. The corrected layout is targeted to become the default in **v1.7.0**.

**Note:** enabling the flag changes the Home Assistant entity IDs for agent-owned containers (the MQTT topic path changes). Update any Home Assistant automations, dashboards, or templates that reference the old (agent-less) entity IDs for agent containers. Single-node deployments are unaffected.

**Migration:** Multi-agent deployments should set `DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT=true` and re-point any affected Home Assistant references before v1.7.0 makes it the default.

## Removed compatibility behaviors

### Legacy aggregate container stats endpoint

| | |
| --- | --- |
| **Deprecated in** | v1.5.0-rc.17 |
| **Removed in** | v1.5.0-rc.17 |
| **Compatibility response added in** | v1.5.0-rc.34 |
| **Affects** | API consumers using `GET /api/v1/containers/stats` for fleet-level CPU/memory summaries |

The legacy aggregate endpoint `GET /api/v1/containers/stats` was removed when fleet-level stats moved to the dedicated stats API. Since v1.5.0-rc.34, the old path returns **410 Gone** with migration targets instead of falling through to the `/:id` container route as container id `stats`.

**Migration:** Replace aggregate reads with `GET /api/v1/stats/summary` or `GET /api/v1/stats/summary/stream`. Use `GET /api/v1/containers/:id/stats` only for per-container stats.

---

### CORS without an explicit origin

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.5.0-rc.9 |
| **Affects** | `DD_SERVER_CORS_ENABLED=true` without `DD_SERVER_CORS_ORIGIN` |

Setting `DD_SERVER_CORS_ENABLED=true` without specifying `DD_SERVER_CORS_ORIGIN` used to fall back to `*` (all origins). Since v1.5.0-rc.9, drydock fails closed instead: startup throws `DD_SERVER_CORS_ORIGIN must be configured when CORS is enabled` and the server does not start.

**Migration:** Set `DD_SERVER_CORS_ORIGIN` explicitly. Use a specific origin (e.g., `https://myapp.example.com`) or `*` if you intentionally want to allow all origins.

## Enforced security changes (no deprecation window)

These behaviors were removed immediately rather than going through a grace period, because the deprecated behavior was itself the vulnerability — keeping it alive behind a warning would have left the hole open. They are listed here for upgrade visibility and migration guidance.

### Implicit reverse-proxy header trust for CSRF origin checks

| | |
| --- | --- |
| **Deprecated in** | v1.5.0-rc.30 |
| **Removed in** | v1.5.0-rc.30 (immediate — security fix, no grace period) |
| **Affects** | TLS-terminating reverse-proxy deployments (Traefik, Nginx, NGINX Proxy Manager, Caddy, HAProxy, Synology DSM, …) without `DD_SERVER_TRUSTPROXY` |

Before rc.30, `getExpectedOrigin()` honored `X-Forwarded-Proto` / `X-Forwarded-Host` unconditionally when validating the same-origin (CSRF) check on state-changing requests. A client could forge those headers to satisfy the check even with `trust proxy` disabled ([`a132318e`](https://github.com/CodesWhat/drydock/commit/a132318e)). rc.30 stopped trusting them unless Express `trust proxy` is enabled. Because the forgeable behavior was the vulnerability, it could not be kept alive behind a deprecation window.

A deployment that terminated TLS at a proxy but never set `DD_SERVER_TRUSTPROXY` previously worked only because the unconditional header trust masked the misconfiguration; after rc.30 it returns `403 CSRF validation failed` on every manual update / recheck / scan ([#418](https://github.com/CodesWhat/drydock/issues/418)). Since v1.5.0-rc.34, Drydock logs a startup warning when it detects `X-Forwarded-Proto: https` while `trust proxy` is disabled, so the requirement is no longer silent.

**Migration:** Set `DD_SERVER_TRUSTPROXY` to the number of proxy hops in front of Drydock (e.g. `1`), and make sure the proxy forwards `X-Forwarded-Proto` (and `X-Forwarded-Host`). See [CSRF validation failed (403) behind a reverse proxy](https://getdrydock.com/docs/faq#csrf-validation-failed-403-behind-a-reverse-proxy).

### Command trigger process-environment inheritance

| | |
| --- | --- |
| **Deprecated in** | v1.5.0-rc.35 |
| **Removed in** | v1.5.0-rc.35 (immediate — security fix, no grace period) |
| **Affects** | `DD_ACTION_COMMAND_*` triggers whose scripts read drydock process environment variables beyond the standard shell set |

Before rc.35, the command trigger spawned user-authored scripts with the entire drydock process environment — including every `DD_*` secret (registry tokens, notification tokens, agent secrets). Any command script, or any binary it invoked, could read credentials it had no need for. Because the inherited-secrets behavior was itself the exposure, it could not be kept alive behind a deprecation window.

Since rc.35 the child environment is a fixed allowlist (`PATH`, `HOME`, `SHELL`, `USER`, `LANG`, `LC_ALL`, `TZ`, `TMPDIR`, `TMP`, `TEMP`) plus the drydock-provided container variables, which are unchanged.

**Migration:** Scripts that legitimately need additional variables from the drydock process name them explicitly with `DD_ACTION_COMMAND_{name}_ENV` (comma-separated), e.g. `DD_ACTION_COMMAND_LOCAL_ENV=KUBECONFIG,DOCKER_HOST`. See the [command trigger docs](https://getdrydock.com/docs/configuration/triggers/command).

### HTTP trigger requests to cloud metadata endpoints

| | |
| --- | --- |
| **Deprecated in** | v1.5.0-rc.35 |
| **Removed in** | v1.5.0-rc.35 (immediate — security fix, no grace period) |
| **Affects** | `DD_NOTIFICATION_HTTP_*` triggers targeting link-local addresses (`169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254`) |

Before rc.35, the HTTP trigger sent requests to any syntactically valid URL, including cloud instance-metadata services (`169.254.169.254` and friends) — an SSRF primitive for anyone able to influence trigger configuration. Requests resolving to link-local/metadata ranges are now rejected before sending. Private-network (RFC-1918) and localhost targets are unaffected — they remain the normal self-hosted case.

**Migration:** The rare deployment that genuinely needs a link-local target sets `DD_NOTIFICATION_HTTP_{name}_ALLOWMETADATA=true` on that trigger. See the [http trigger docs](https://getdrydock.com/docs/configuration/triggers/http).
