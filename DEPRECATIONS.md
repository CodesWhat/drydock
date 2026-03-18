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

### SHA-1 Basic Auth Password Hashes

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_AUTH_BASIC_*_HASH` values using `{SHA}<base64>` format |

Legacy SHA-1 `{SHA}` password hashes inherited from the upstream WUD project are accepted with deprecation warnings. SHA-1 is cryptographically broken and unsuitable for password hashing.

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
| **Deprecated in** | v1.2.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Containers using `wud.*` labels (e.g., `wud.watch`, `wud.tag.include`) |

Legacy `wud.*` labels from the upstream WUD project are accepted as fallbacks for their `dd.*` equivalents. Each fallback logs a deprecation warning on first use.

**Migration:** Rename all `wud.*` labels to `dd.*` on your containers (e.g., `wud.watch=true` becomes `dd.watch=true`). Use `node dist/index.js config migrate` to automate the conversion across compose files and `.env` files.

---

### Legacy `WUD_*` environment variables

| | |
| --- | --- |
| **Deprecated in** | v1.2.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Configurations using `WUD_*` env vars (e.g., `WUD_AGENT_SECRET`) |

Legacy `WUD_*` environment variables are accepted as fallbacks for their `DD_*` equivalents. Usage is tracked via the `dd_legacy_input_total` Prometheus counter.

**Migration:** Rename all `WUD_*` environment variables to `DD_*` (e.g., `WUD_AGENT_SECRET` becomes `DD_AGENT_SECRET`). Use `node dist/index.js config migrate` for automated conversion.

---

### `DD_WATCHER_{name}_WATCHDIGEST` environment variable

| | |
| --- | --- |
| **Deprecated in** | v1.2.0 |
| **Removed in** | v1.6.0 |
| **Affects** | Configurations using `DD_WATCHER_{name}_WATCHDIGEST` |

The `WATCHDIGEST` env var is deprecated. Use the `dd.watch.digest=true` container label for per-container digest watching instead.

**Migration:** Remove `DD_WATCHER_{name}_WATCHDIGEST` from your environment and add `dd.watch.digest=true` as a label on individual containers that need digest-level monitoring.

---

### `DD_WATCHER_{name}_WATCHATSTART` environment variable

| | |
| --- | --- |
| **Deprecated in** | v1.2.0 |
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
| **Deprecated in** | v1.3.0 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_REGISTRY_HUB_PUBLIC_TOKEN`, `DD_REGISTRY_DHI_TOKEN`, and similar token-auth env vars |

Token-based authentication for public registries has been replaced by password-based authentication for consistency.

**Migration:** Replace `DD_REGISTRY_HUB_PUBLIC_TOKEN` with `DD_REGISTRY_HUB_PUBLIC_PASSWORD`. Replace `DD_REGISTRY_DHI_TOKEN` with `DD_REGISTRY_DHI_PASSWORD`.
