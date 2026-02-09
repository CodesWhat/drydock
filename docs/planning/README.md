# Planning

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
| #891 Auth for remote Docker/Podman host API | High | Add watcher support for upstream auth headers/tokens behind reverse proxies |
| #875 Support `dhi.io` registry | Medium | Add provider/matcher support and docs |
| #896 OIDC `checks.state` intermittent errors | Medium | Needs deeper repro and session/state handling validation |
| #881 `semverDiff` undefined in templates | Medium | Confirm path/rendering behavior for minor/patch and add tests |

## Next Focus

1. Implement #891 phase 1 (`Basic` + `Bearer` auth support for remote watchers).
2. Add `dhi.io` registry support (#875).
3. Triage OIDC state issue (#896) with reproducible test case and logs.
