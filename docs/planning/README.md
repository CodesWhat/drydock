# Roadmap

Last updated: 2026-02-09

## Current State

`main` is stable and includes recent fixes for watcher/trigger reliability, agent mode, and docs/CI cleanup.

## Recently Completed

| Item | Status | Notes |
| --- | --- | --- |
| #910 Distributed Monitoring (Agent Mode) | Done | Merged to `main` (`f3cee9b`, `00968f3`) |
| #868 docker-compose `post_start` not run | Done | `dockercompose` trigger now executes post-start hooks (`7debff9`) |
| #878 Metrics endpoint auth toggle | Done | Added `WUD_SERVER_METRICS_AUTH` (`66f36f4`) |
| #882 NTFY threshold env handling | Done | Provider-level threshold support (`50ee000`) |
| #884 Docker watcher JSON chunk crash | Done | Event stream buffering/parsing hardened (`dea5b05`) |
| #885 Multi-network container recreate failure | Done | Recreate now connects extra networks after create (`40adf42`) |
| #887 Remote watcher delayed first scan | Done | `watchatstart` now checks watcher-local store (`7ff0f24`) |
| CI config cleanup | Done | Removed Code Climate stub, renamed to `ci.config.yml` (`540afe1`, `2e4e9a6`) |

## Planned / Open

| Item | Priority | Notes |
| --- | --- | --- |
| #891 Auth for remote Docker/Podman host API | High | Valid security gap (not user error). Phase 1: add `Basic` + `Bearer` auth for `WUD_WATCHER_{name}_HOST` over HTTPS while keeping existing mTLS options (`CAFILE`/`CERTFILE`/`KEYFILE`). Phase 2: OIDC token acquisition/refresh support. |
| #875 Support `dhi.io` registry | Medium | Add provider/matcher support and docs |
| #768 Skip/snooze a specific update version | Medium | Add per-container skip list and optional TTL-based snooze (stored in DB, not labels) |
| #770 Container name stuck on temporary name | Medium | Refresh container name/labels on existing store entries (watcher update path) |
| #777 Real-time Docker pull progress logging | Low | Add `followProgress` progress callback; consider rate-limited logging |
| #896 OIDC `checks.state` intermittent errors | Medium | Needs deeper repro and session/state handling validation |
| #881 `semverDiff` undefined in templates | Medium | Confirm path/rendering behavior for minor/patch and add tests |

## Next Focus

1. Implement #891 phase 1 (`Basic` + `Bearer` auth support for remote watchers).
2. Add `dhi.io` registry support (#875).
3. Triage OIDC state issue (#896) with reproducible test case and logs.

## Roadmap Detail: #891

### Phase 1 (next)

- Add remote watcher HTTP authentication for upstream `WUD_WATCHER_{name}_HOST` endpoints:
  - `Basic` auth
  - `Bearer` token auth
- Scope this to HTTPS remote endpoints.
- Keep existing mTLS options unchanged:
  - `WUD_WATCHER_{name}_CAFILE`
  - `WUD_WATCHER_{name}_CERTFILE`
  - `WUD_WATCHER_{name}_KEYFILE`

### Phase 2 (later)

- Evaluate/implement full OIDC client flow for remote watcher upstream auth:
  - token acquisition
  - token refresh
