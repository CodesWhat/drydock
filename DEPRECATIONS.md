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

### PUT /api/settings

| | |
| --- | --- |
| **Deprecated in** | v1.4.0 |
| **Removed in** | v1.5.0 |
| **Affects** | API consumers using `PUT /api/settings` |

`PUT /api/settings` is a compatibility alias for `PATCH /api/settings`. Use `PATCH` for partial settings updates.

**Migration:** Replace `PUT /api/settings` calls with `PATCH /api/settings`.

---

### CORS without explicit origin

| | |
| --- | --- |
| **Deprecated in** | v1.4.1 |
| **Removed in** | v1.6.0 |
| **Affects** | `DD_SERVER_CORS_ENABLED=true` without `DD_SERVER_CORS_ORIGIN` |

Setting `DD_SERVER_CORS_ENABLED=true` without specifying `DD_SERVER_CORS_ORIGIN` currently falls back to `*`. This implicit wildcard is deprecated.

**Migration:** Set `DD_SERVER_CORS_ORIGIN` explicitly. Use a specific origin (e.g., `https://myapp.example.com`) or `*` if you intentionally want to allow all origins.
