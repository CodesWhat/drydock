# Deprecations

Active deprecations and their removal timeline. Each entry includes the version it was deprecated, the version it will be removed, and migration guidance.

**API versioning policy:** `/api/v1` is the frozen, canonical API contract. Breaking response-shape changes are never made to `/api/v1` — they only ever land as a new `/api/v2`. The unversioned `/api` alias is removed in v1.6.0. Two kinds of endpoint used to keep responding at `/api/*` after that removal, both because they were registered directly on the app rather than through the removed alias router: the flag-gated wud-card compatibility endpoints (see the Unversioned `/api/*` path entry below), and the standalone auth aliases `GET /api/auth/methods` and `GET /api/auth/status`. `GET /api/auth/methods` was removed on its own v1.7.0 schedule (see Removed compatibility behaviors below) and now falls through to the same tombstone as the rest of the unversioned surface; `GET /api/auth/status` remains, with no removal scheduled (see its entry below).

## Active

### PUT /api/v1/settings

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removal** | Deferred to API v2 — `/api/v1` is frozen, so the method cannot be dropped from it; the `Sunset` header advertises 2027-01-01 as the earliest retirement instant |
| **Affects** | API consumers using `PUT /api/v1/settings` |

`PUT /api/v1/settings` is a compatibility alias for `PATCH /api/v1/settings`. Use `PATCH` for partial settings updates. An earlier revision of this entry scheduled the removal for v1.6.0; that predated the API versioning policy freezing `/api/v1`, under which removing a method from the versioned surface is a breaking change reserved for `/api/v2`.

The unversioned `/api/settings` path is not a working alias for this endpoint. Like the rest of the unversioned surface it returns `410 Gone` (see the Unversioned `/api/*` path entry below); settings is not one of the four wud-card compatibility endpoints exempted from that tombstone.

**Migration:** Replace `PUT /api/v1/settings` calls with `PATCH /api/v1/settings`.

---

### Legacy auth strategies response shape (`GET /auth/strategies`)

| | |
| --- | --- |
| **Deprecated in** | v1.6.0 |
| **Removal** | v1.8.0 |
| **Affects** | Clients reading `{ strategies, warnings }` from `GET /auth/strategies` |

`GET /auth/strategies` returns the older `{ strategies, warnings }` response shape. The canonical replacement, `GET /api/v1/auth/status` (also available at `/api/auth/status` and `/auth/status`), returns `{ providers, errors }`. Each request now logs a deprecation warning and returns RFC 9745 `Deprecation` and RFC 8594 `Sunset` headers. The `Sunset` header advertises 2028-07-01, a deliberately conservative earliest-retirement instant, not the actual removal date; the endpoint is removed at the v1.8.0 release, which ships well before that date.

**Migration:** Read `providers`/`errors` from `GET /api/v1/auth/status` instead of `strategies`/`warnings` from `GET /auth/strategies`.

---

## Removed compatibility behaviors

### `curl` in Docker image

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.7.0 |
| **Affects** | Custom `healthcheck:` overrides in compose files that used `curl` |

The official Docker image kept `curl` available in v1.5.x and v1.6.x for backward compatibility with custom healthcheck overrides. The default built-in `HEALTHCHECK` has used the lightweight static binary (`/bin/healthcheck`) instead since v1.5.0. v1.7.0 removes `curl` from the image entirely; a container whose own `HEALTHCHECK` override still shells out to `curl` now fails, and drydock logs a startup warning naming the container when it detects the override.

**Migration:** Switch custom healthcheck overrides to `test: /bin/healthcheck $${DD_SERVER_PORT:-3000}` (the doubled `$` is compose escaping, so the variable is expanded inside the container instead of from the host environment before the container starts), or drop the override to use the built-in image healthcheck. See [Monitoring](https://getdrydock.com/docs/monitoring).

---

### Legacy trigger prefix inputs (`DD_TRIGGER_*`, `dd.trigger.*`)

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.7.0 |
| **Affects** | Trigger configs using `DD_TRIGGER_*` env vars and container labels `dd.trigger.include` / `dd.trigger.exclude` |

`DD_TRIGGER_*` and `dd.trigger.*` were accepted as compatibility aliases while the trigger taxonomy moved to action/notification prefixes, and were logged at `error` level throughout v1.6.0 as a loud migration signal. Both are removed in v1.7.0:

- **`DD_TRIGGER_*` environment variables now fail startup.** Any detected `DD_TRIGGER_*` variable raises a startup error that lists every offending variable with its exact `DD_ACTION_*` / `DD_NOTIFICATION_*` replacement (action for `docker`/`dockercompose`/`command`, notification for every other provider), plus the `config migrate --source trigger` command and a link to this page. Drydock does not start until every listed variable is renamed.
- **`dd.trigger.include` / `dd.trigger.exclude` container labels no longer resolve to anything.** They stopped acting as a per-category fallback beneath `dd.action.include` / `dd.action.exclude` and `dd.notification.include` / `dd.notification.exclude`; only the scoped labels are read now. A container still carrying either legacy label logs an `error`-level warning (once per label key) and increments the `dd_legacy_input_total{source="label"}` counter, so a fleet that hasn't migrated its labels stays visible in the deprecation banner and Prometheus — the label is just no longer consulted for actual include/exclude filtering.

**Migration:** Prefer `DD_ACTION_*` / `DD_NOTIFICATION_*` and `dd.action.*` / `dd.notification.*`.

The migration CLI can rewrite legacy trigger prefixes for you:

```bash
# Preview changes
node dist/index.js config migrate --source trigger --dry-run

# Apply to specific files
node dist/index.js config migrate --source trigger --file .env --file compose.yaml
```

The CLI rewrites legacy trigger keys to action-prefixed aliases by default (`DD_ACTION_*`, `dd.action.*`), which remain fully compatible. It runs as a standalone text-rewriting tool over local config files — it is unaffected by the runtime removal above and stays available indefinitely as the migration path off `DD_TRIGGER_*` / `dd.trigger.*`.

---

### Manual updates bypassing `dd.action.include` / `dd.action.exclude`

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Removed in** | v1.7.0 |
| **Affects** | Containers labeled with `dd.action.include` / `dd.action.exclude` where the labels filter out the matching docker / dockercompose action trigger (v1.7.0 ignores the legacy `dd.trigger.*` labels — see the runtime removal above) |

In v1.5.x–v1.6.x the eligibility model classified `trigger-not-included` and `trigger-excluded` as **soft** blockers: the row pill said *Trigger filtered* / *Trigger excluded*, but clicking the per-row Update button still queued the update (the confirm modal listed the soft blocker and switched the accept label to *Update anyway*). This preserved the pre-v1.5 behavior where include/exclude was an *auto-trigger* filter only — manual click bypassed it.

As of v1.7.0 both reasons are **hard** blockers, shipping together with the per-action execution policy (`dd.action.auto` container label, `AUTO=onauto` trigger mode — spec-6.0.1-action-policy.md) that separates action authorization from automatic promotion, so the manual-only escape hatch isn't removed on its own. The Update button is now locked when the labels filter out the action trigger, and the API rejects a manual update request with the blocker's message (`409`). The labels now mean what the pill always said: *this trigger does not handle this container*.

**This does not change `AUTO=oninclude`'s meaning.** A trigger left on `AUTO=oninclude` keeps its pre-6.0.1 conflated behavior permanently: a matching `dd.action.include` label still grants both manual and automatic access under that mode, exactly as before — that row of the migration table is explicitly unchanged. Only the *default-deny* outcome (no matching include/auto label at all) and the *explicit-exclude* outcome (`dd.action.exclude` match) flip from soft to hard. An operator who wants the split between manual-only and automatic access opts in by switching a trigger to `AUTO=onauto`; nothing about this flip forces that switch.

**Migration:** If legacy `dd.trigger.include` / `dd.trigger.exclude` labels are still present, first rename them to the corresponding `dd.action.*` labels (v1.7.0 no longer reads them — the migration CLI above does this rewrite). Then, if you relied on manual updates running through a trigger that the container's labels excluded, either (a) remove the `dd.action.exclude` label from the container, (b) add the trigger to the container's `dd.action.include` list (or `dd.action.auto` list, for a trigger configured with `AUTO=onauto`), or (c) configure a separate action trigger that the labels permit. The eligibility pill on the row identifies exactly which trigger / label combination is in conflict.

---

### Agent-less Home Assistant MQTT topic layout (multi-agent)

| | |
| --- | --- |
| **Deprecated in** | v1.5.0 |
| **Default flipped in** | v1.7.0 |
| **Affects** | Multi-agent deployments using the Home Assistant MQTT integration (`DD_NOTIFICATION_MQTT_<name>_HASS_ENABLED=true`) where more than one node used the default watcher name `local` |

Through v1.6.x, the Home Assistant MQTT topic layout (`<topic>/<watcher>/<container>` and the watcher-level sensor topics) had no agent segment. In a multi-agent deployment where the controller and one or more agents all used the default watcher name `local`, two containers with the same name on different agents published to — and overwrote — the same MQTT topic, watcher running-status topics collided, and the watcher-level sensor counts summed across all agents. This was the Home Assistant facet of [#386](https://github.com/CodesWhat/drydock/issues/386).

As of v1.7.0, `DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT` defaults to `true`: an `agent/<name>` segment is now inserted into every Home Assistant topic for containers owned by a remote agent, watcher running-status topics and watcher-level sensor counts are scoped per agent, and discovery-entity cleanup is scoped per agent. Controller-local container topics are unchanged either way. Setting `DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT=false` remains available as a temporary opt-out back to the old, unscoped layout; a shared watcher name across agents on that opt-out reproduces the original collision, which `warnIfAgentlessHassTopicLayoutCollides` (`app/triggers/providers/mqtt/Hass.ts`) now warns about explicitly, once per watcher name.

**What upgrading multi-agent deployments see in Home Assistant:** agent-owned container and watcher entities move to new topic paths — new entity IDs — the first time drydock starts under v1.7.0 without the opt-out set. **The old (pre-v1.7.0) discovery entities are not retroactively removed.** Discovery cleanup only clears topics drydock currently has in memory: the per-container "previous topic" tracking is an in-memory map that starts empty on every process restart, and the watcher-level and aggregate sensors never tracked a prior topic scheme at all. The pre-v1.7.0 entities stay retained on the broker and show up in Home Assistant as orphaned, frozen-at-last-state duplicates alongside the new ones until manually removed (delete the entities in Home Assistant, or clear the retained messages on the broker, once the new entities are confirmed working).

**Migration:** No action is required for the default flip itself. Update any Home Assistant automations, dashboards, or templates that reference the old (agent-less) entity IDs for agent-owned containers, and manually remove the orphaned old-path discovery entities described above. Deployments not yet ready to migrate can set `DD_NOTIFICATION_MQTT_<name>_HASS_AGENTTOPICSEGMENT=false` to keep the pre-v1.7.0 layout temporarily.

---

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

### Agent-mode `WUD_AGENT_SECRET` / `WUD_AGENT_SECRET_FILE` fallback

| | |
| --- | --- |
| **Deprecated in** | Never — removed directly, no deprecation period |
| **Removed in** | v1.6.0-rc.1 |
| **Affects** | Agent-mode deployments (`app/agent/api/index.ts`) configured with only `WUD_AGENT_SECRET` / `WUD_AGENT_SECRET_FILE`, no `DD_AGENT_SECRET` / `DD_AGENT_SECRET_FILE` |

This is a separate, undocumented removal from the general `WUD_*` table above. Unlike the general configuration loader — which never read `WUD_*` variables at all — agent mode's secret lookup carried its own explicit fallback through v1.5.2: `process.env.DD_AGENT_SECRET ?? process.env.WUD_AGENT_SECRET` (and the equivalent for `_FILE`). v1.6.0-rc.1 dropped both fallbacks with no warning release first. An agent that had only `WUD_AGENT_SECRET` set went straight from authenticating successfully to `init()` throwing `Agent mode requires DD_AGENT_SECRET or DD_AGENT_SECRET_FILE` at startup — an error message that never mentions the `WUD_` variable the operator actually configured. This entry was never recorded at the time of the v1.6.0 release; it is added here retroactively.

**Migration:** Rename `WUD_AGENT_SECRET` to `DD_AGENT_SECRET` and `WUD_AGENT_SECRET_FILE` to `DD_AGENT_SECRET_FILE`.

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

Separately, `GET /api/auth/status` also keeps responding 200 at `/api/*` — unconditionally, not behind any flag — because it is registered directly on the app before the `/api` mounts rather than living inside the removed alias router. It has no removal scheduled and is documented as a standing compatibility alias for `GET /api/v1/auth/status`. `GET /api/auth/methods` used to keep responding for the same reason; see the entry immediately below for its v1.7.0 removal.

---

### Unversioned `GET /api/auth/methods` alias

| | |
| --- | --- |
| **Deprecated in** | v1.6.0 |
| **Removed in** | v1.7.0 |
| **Affects** | API consumers using `GET /api/auth/methods` |

`GET /api/auth/methods` was a legacy, unversioned auth-discovery alias kept unauthenticated so the login screen could render before a session existed. It logged a deprecation warning on each request and returned RFC 9745 `Deprecation` and RFC 8594 `Sunset` response headers pointing callers at `GET /api/v1/auth/status`. Because it was registered directly on the app, ahead of the `/api` mount, it survived the general unversioned `/api/*` removal above on its own v1.7.0 timeline. That registration is gone as of v1.7.0: the route is no longer mounted anywhere, so a request to it now falls through to the same unversioned `/api/*` **410 Gone** tombstone described above. `GET /api/auth/status` is unaffected and remains a standing compatibility alias for `GET /api/v1/auth/status` with no removal scheduled.

**Migration:** Replace `GET /api/auth/methods` with `GET /api/v1/auth/status`.

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

### Implicit reverse-proxy header trust for WebSocket origin checks

| | |
| --- | --- |
| **Deprecated in** | v1.6.0-rc.3 |
| **Removed in** | v1.6.0-rc.3 (immediate — security fix, no grace period) |
| **Affects** | TLS-terminating reverse-proxy deployments (Traefik, Nginx, NGINX Proxy Manager, Caddy, HAProxy, Synology DSM, …) without `DD_SERVER_TRUSTPROXY` using the log-stream (`/api/v1/log/stream`) or container log-stream (`/api/v1/containers/{id}/logs/stream`) WebSocket endpoints |

Before rc.3, `isOriginAllowed()` (`app/api/ws-upgrade-utils.ts`) validated a WebSocket upgrade's `Origin` header by comparing host only — the same gap the CSRF check above had before rc.30. rc.3 extends the check to also validate scheme, honoring `X-Forwarded-Proto` / `X-Forwarded-Host` only when Express `trust proxy` is enabled; otherwise the socket's own transport (encrypted or not) decides the expected scheme. Because the forgeable behavior was the vulnerability, it could not be kept alive behind a deprecation window.

A deployment that terminates TLS at a proxy but never set `DD_SERVER_TRUSTPROXY` will now have WebSocket upgrades to these endpoints rejected with `403`, the same way REST CSRF checks broke in rc.30.

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

### Anonymous-auth grandfather path for upgrades

| | |
| --- | --- |
| **Deprecated in** | v1.6.0-rc.3 |
| **Removed in** | v1.6.0-rc.3 (immediate — security fix, no grace period) |
| **Affects** | Upgrading instances (an existing `/store/dd.json`) with no authentication configured, or with anonymous auth enabled but not explicitly confirmed |

Before rc.3, an upgrading instance with no auth strategy configured was let through with anonymous access and a startup warning — the same grandfather path drydock used before v1.4.0 enforced authentication on fresh installs. rc.3 removes it: `app/authentications/providers/anonymous/Anonymous.ts` now rejects unconfirmed anonymous registration for upgrades exactly as it already did for fresh installs. The registry fallback catches that registration error, so the process continues running while protected API requests are rejected with `401`, auth discovery/status remains public, `/health` returns `503`, and the SPA shell cannot read protected application data. Because the warn-and-serve behavior was itself the exposure — an open dashboard reachable without credentials — it could not be kept alive behind a deprecation window.

**Migration:** Set `DD_AUTH_BASIC_<name>_USER`/`_HASH` (or configure OIDC) before upgrading, or set `DD_ANONYMOUS_AUTH_CONFIRM=true` to explicitly keep the instance anonymous. See [Authentication](https://getdrydock.com/docs/configuration/authentications).

### Session cookie renamed `connect.sid` → `drydock.sid`

| | |
| --- | --- |
| **Deprecated in** | v1.6.0-rc.3 |
| **Removed in** | v1.6.0-rc.3 (immediate — security fix, no grace period) |
| **Affects** | Every authenticated session, Basic and OIDC alike |

Before rc.3, drydock served sessions under Express's default cookie name, `connect.sid` — the same name countless other Express apps use, making a drydock session fingerprintable and a potential collision risk with another Express app on the same host/path. rc.3 renames the cookie to `drydock.sid`. Because a shared, guessable session-cookie name was itself the exposure, it could not be kept alive behind a deprecation window.

**Migration:** None required. Existing `connect.sid` cookies are simply no longer recognized, so every user is signed out once on upgrade and needs to log back in. No data is lost.
