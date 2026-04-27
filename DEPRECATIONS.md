# Deprecations

Active deprecations and their removal timeline. Each entry includes the version it was deprecated, the version it will be removed, and migration guidance.

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

### CORS without explicit origin

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_SERVER_CORS_ENABLED=true` without `DD_SERVER_CORS_ORIGIN` |

Setting `DD_SERVER_CORS_ENABLED=true` without specifying `DD_SERVER_CORS_ORIGIN` currently falls back to `*`. This implicit wildcard is deprecated.

**Migration:** Set `DD_SERVER_CORS_ORIGIN` explicitly. Use a specific origin (e.g., `https://myapp.example.com`) or `*` if you intentionally want to allow all origins.

---

### Unversioned `/api/*` path

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | API consumers using `/api/...` instead of `/api/v1/...` |

`/api/*` is a backward-compatible alias for `/api/v1/*`. The alias will be removed in v1.6.0.

**Migration:** Update all API calls to use the `/api/v1/` prefix (e.g., `/api/v1/containers` instead of `/api/containers`).

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
| **Affects** | `DD_REGISTRY_HUB_PUBLIC_TOKEN`, `DD_REGISTRY_DHI_TOKEN`, and similar token-auth env vars |

Token-based authentication for public registries has been replaced by password-based authentication for consistency.

**Migration:** Replace `DD_REGISTRY_HUB_PUBLIC_TOKEN` with `DD_REGISTRY_HUB_PUBLIC_PASSWORD`. Replace `DD_REGISTRY_DHI_TOKEN` with `DD_REGISTRY_DHI_PASSWORD`.
