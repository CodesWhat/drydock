# Deprecations

Active deprecations and their removal timeline. Each entry includes the version it was deprecated, the version it will be removed, and migration guidance.

**API versioning policy:** `/api/v1` is the frozen, canonical API contract. Breaking response-shape changes are never made to `/api/v1` — they only ever land as a new `/api/v2`. The unversioned `/api` alias is removed in v1.6.0. Two kinds of endpoint keep responding at `/api/*` after that removal, both because they are registered directly on the app rather than through the removed alias router: the flag-gated wud-card compatibility endpoints (see the Unversioned `/api/*` path entry below), and the standalone auth aliases `GET /api/auth/methods` and `GET /api/auth/status` (see their entries below).

## Active

### PUT /api/settings

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removal** | Deferred to API v2 — `/api/v1` is frozen, so the method cannot be dropped from it; the `Sunset` header advertises 2027-01-01 as the earliest retirement instant |
| **Affects** | API consumers using `PUT /api/settings` |

`PUT /api/settings` is a compatibility alias for `PATCH /api/settings`. Use `PATCH` for partial settings updates. An earlier revision of this entry scheduled the removal for v1.6.0; that predated the API versioning policy freezing `/api/v1`, under which removing a method from the versioned surface is a breaking change reserved for `/api/v2`.

**Migration:** Replace `PUT /api/settings` calls with `PATCH /api/settings`.

---

### Unversioned `GET /api/auth/methods` alias

| | |
| --- | --- |
| **Deprecated in** | v1.6.0 |
| **Removed in** | v1.7.0 |
| **Affects** | API consumers using `GET /api/auth/methods` |

`GET /api/auth/methods` is a legacy, unversioned auth-discovery alias kept unauthenticated so the login screen can render before a session exists. It logs a deprecation warning on each request, returns RFC 9745 `Deprecation` and RFC 8594 `Sunset` response headers, and points callers directly to `GET /api/v1/auth/status`. It is registered directly on the app, so it survives the general unversioned `/api/*` removal on its own v1.7.0 timeline. `GET /api/auth/status` is a standing compatibility alias for `GET /api/v1/auth/status` with no removal scheduled.

**Migration:** Replace `GET /api/auth/methods` with `GET /api/v1/auth/status`.

---

### Legacy auth strategies response shape (`GET /auth/strategies`)

| | |
| --- | --- |
| **Deprecated in** | v1.6.0 |
| **Removed in** | v1.8.0 |
| **Affects** | Clients reading `{ strategies, warnings }` from `GET /auth/strategies` |

`GET /auth/strategies` returns the older `{ strategies, warnings }` response shape. The canonical replacement, `GET /api/v1/auth/status` (also available at `/api/auth/status` and `/auth/status`), returns `{ providers, errors }`. Each request now logs a deprecation warning and returns RFC 9745 `Deprecation` and RFC 8594 `Sunset` headers for its v1.8.0 removal.

**Migration:** Read `providers`/`errors` from `GET /api/v1/auth/status` instead of `strategies`/`warnings` from `GET /auth/strategies`.

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

Starting in v1.6.0, every detected `DD_TRIGGER_*` variable and deprecated `dd.trigger.*` label is logged at `error` level. This is an intentionally loud migration signal; the legacy inputs remain functional until their planned removal in v1.7.0.

The `dd.trigger.include` / `dd.trigger.exclude` labels apply to both trigger categories as a shared fallback beneath `dd.action.include` / `dd.action.exclude` and `dd.notification.include` / `dd.notification.exclude`: for a given category, the legacy label is only consulted when that category's own scoped label is absent from the container. It is not merged with a scoped label that is present.

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

### v1.6.0 configuration and authentication removals

The following v1.4-era compatibility inputs are no longer executed in v1.6.0:

| Removed input | v1.6.0 behavior | Migration |
| --- | --- | --- |
| HTTP OIDC discovery URLs | Authentication registration rejects non-HTTPS discovery URLs. | Serve discovery over HTTPS and update `DD_AUTH_OIDC_<name>_DISCOVERY`. |
| `{SHA}`, `$apr1$`/`$1$`, `crypt`, and plain-text Basic hashes | Authentication registration accepts only the documented argon2id hash schema. | Generate an argon2id hash and update `DD_AUTH_BASIC_<name>_HASH`. |
| `WUD_*` environment variables | Ignored; only `DD_*` variables are loaded. | Rename them manually or with `node dist/index.js config migrate`. |
| `wud.*` Docker labels | Ignored; only `dd.*` labels affect runtime behavior. | Rename them manually or with `node dist/index.js config migrate`. |
| `DD_WATCHER_<name>_WATCHDIGEST` | Rejected as an unknown watcher setting. | Use `dd.watch.digest=true` per container. |
| `DD_WATCHER_<name>_WATCHATSTART` | Rejected as an unknown watcher setting; startup scans are always scheduled. | Remove it and use `CRON` to control later scans. |
| Legacy trigger template variables (`$id`, `$name`, `$watcher`, `$kind`, `$semver`, `$local`, `$remote`, `$link`, `$count`) | No alias values are supplied to templates. | Use `$container.*`, canonical update fields, and `$containers.length`. |
| Kafka trigger `clientId` | Trigger validation rejects the camel-case key. | Rename it to `clientid`. |
| Token-only Hub/DHI public instance configuration (for example `DD_REGISTRY_HUB_PUBLIC_TOKEN` without `..._PUBLIC_LOGIN`) | Registry validation fails closed instead of silently switching to anonymous access. The `TOKEN` key itself remains valid when paired with `LOGIN`. | Configure the named instance with `LOGIN`+`PASSWORD`, `LOGIN`+`TOKEN`, or `AUTH`; remove credentials entirely for intentional anonymous access. |

The migration CLI intentionally retains knowledge of the removed WUD names so it can rewrite old configuration files; this is migration support, not runtime compatibility.

---

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

---

### Unversioned `/api/*` path

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | API consumers using `/api/...` instead of `/api/v1/...` |

`/api/*` was a backward-compatible alias for `/api/v1/*`. Since v1.6.0, unversioned `/api/*` requests (other than the exceptions below) return **410 Gone** with a JSON body pointing at the `/api/v1/` equivalent instead of being served.

**Migration:** Update all API calls to use the `/api/v1/` prefix (e.g., `/api/v1/containers` instead of `/api/containers`).

**Exceptions:** the opt-in wud-card compatibility endpoints (`DD_COMPAT_WUDCARD`, default `false`) remain mounted at `/api/*` and are unaffected by this removal — the compat router dispatches its four whitelisted routes directly into the same `apiRouter` instance mounted at `/api/v1` (shared, not a second independent one — see `app/api/compat/wudcard.ts`) rather than by falling through to the (now-removed) `/api` alias, so auth and rate limiting are genuinely identical rather than merely implemented identically. They exist solely to keep the Home Assistant [wud-card](https://github.com/angryvoegi/wud-card) integration (and Homepage's native `whatsupdocker` widget, which expects the same bare-array shape) working, are off by default, and are best-effort with no compatibility guarantee — see [Server configuration](https://getdrydock.com/docs/configuration/server) for details.

Separately, `GET /api/auth/methods` and `GET /api/auth/status` also keep responding 200 at `/api/*` — unconditionally, not behind any flag — because both are registered directly on the app before the `/api` mounts rather than living inside the removed alias router. See the Unversioned `GET /api/auth/methods` alias entry above for its own v1.7.0 removal timeline; `GET /api/auth/status` has no removal scheduled and is documented as a standing compatibility alias for `GET /api/v1/auth/status`.

---

### Unversioned WS `/api/log/stream` alias

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.6.0 |
| **Affects** | WebSocket clients upgrading at `/api/log/stream` instead of `/api/v1/log/stream` |

The system log stream WebSocket (`app/api/log-stream.ts`) accepted both the versioned `/api/v1/log/stream` path and the unversioned `/api/log/stream` alias, following the same transition-alias policy as the REST `/api/*` path above. Since v1.6.0, an upgrade request to the unversioned path is rejected with **410 Gone** (`The unversioned /api/log/stream path was removed in v1.6.0. Use /api/v1/log/stream instead.`) instead of being served.

**Migration:** Point WebSocket clients at `/api/v1/log/stream`.

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
