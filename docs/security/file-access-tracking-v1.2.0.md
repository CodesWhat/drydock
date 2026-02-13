# File Access Findings Tracking (v1.2.0)

Scope: Critical `Security / File Access` findings for v1.2.0 hardening work.
Branch context: `feature/v1.2.0`
Last updated: 2026-02-12

## Status Legend
- `Mitigated`: path input is now validated/normalized before filesystem access.
- `Accepted Risk`: path is internally generated or constrained; no external path injection surface.
- `Pending`: not yet addressed.

## Findings

| # | File | Finding | Status | Notes |
|---|---|---|---|---|
| 1 | `app/configuration/index.ts` | `fs.readFileSync(secretFilePath, 'utf-8')` | Mitigated | `secretFilePath` now goes through `resolveConfiguredPath(...)` in `replaceSecrets`. |
| 2 | `app/api/index.ts` | `fs.readFileSync(configuration.tls.key)` | Mitigated | TLS key path normalized with `resolveConfiguredPath(...)`. |
| 3 | `app/api/index.ts` | `fs.readFileSync(configuration.tls.cert)` | Mitigated | TLS cert path normalized with `resolveConfiguredPath(...)`. |
| 4 | `app/agent/AgentClient.ts` | `fs.readFileSync(this.config.cafile)` | Mitigated | `cafile` normalized with `resolveConfiguredPath(...)` before read. |
| 5 | `app/agent/AgentClient.ts` | `fs.readFileSync(this.config.certfile)` | Mitigated | `certfile` normalized with `resolveConfiguredPath(...)` before read. |
| 6 | `app/agent/AgentClient.ts` | `fs.readFileSync(this.config.keyfile)` | Mitigated | `keyfile` normalized with `resolveConfiguredPath(...)` before read. |
| 7 | `app/triggers/providers/dockercompose/Dockercompose.ts` | `fs.writeFile(file, data)` | Mitigated | write path normalized with `resolveConfiguredPath(...)`. |
| 8 | `app/triggers/providers/dockercompose/Dockercompose.ts` | `fs.readFile(filePath)` | Mitigated | read path normalized with `resolveConfiguredPath(...)`. |
| 9 | `app/registry/index.ts` | `fs.readdirSync(resolvedPath)` | Mitigated | provider path now bounded via `resolveConfiguredPathWithinBase(runtimeRoot, ...)`. |
| 10 | `app/registry/index.ts` | `fs.statSync(filePath).isDirectory()` | Mitigated | directory checks run on runtime-root bounded path set. |
| 11 | `app/registry/index.ts` | `fs.existsSync(jsCandidate)` | Mitigated | module base path constrained within runtime root before extension checks. |
| 12 | `app/registry/index.ts` | `fs.existsSync(tsCandidate)` | Mitigated | module base path constrained within runtime root before extension checks. |
| 13 | `app/registry/index.ts` | `fs.existsSync(componentFileByConvention + ext)` | Mitigated | component root now runtime-root bounded with `resolveConfiguredPathWithinBase(...)`. |
| 14 | `app/store/index.ts` | `fs.existsSync/storePath/legacyPath/mkdir/rename` chain | Mitigated | store paths normalized from validated config and constrained before operations. |
| 15 | `app/triggers/providers/mqtt/Mqtt.ts` | TLS `clientkey/clientcert/cachain` file reads | Mitigated | all file paths validated via `resolveConfiguredPath(...)`. |
| 16 | `app/watchers/providers/docker/Docker.ts` | TLS `cafile/certfile/keyfile` reads | Mitigated | all file paths validated via `resolveConfiguredPath(...)`. |
| 17 | `app/runtime/paths.ts` | `fs.statSync(candidate).isDirectory()` probe | Accepted Risk | candidate list is internally generated runtime discovery paths, not user-provided. |

## Implemented Hardening

- Added/used path-safety utilities in `app/runtime/paths.ts`:
  - `resolveConfiguredPath(...)`
  - `resolveConfiguredPathWithinBase(...)`
- Applied path normalization and boundary checks in:
  - `app/configuration/index.ts`
  - `app/api/index.ts`
  - `app/agent/AgentClient.ts`
  - `app/triggers/providers/dockercompose/Dockercompose.ts`
  - `app/registry/index.ts`
  - previously hardened: `app/store/index.ts`, `app/triggers/providers/mqtt/Mqtt.ts`, `app/watchers/providers/docker/Docker.ts`

## Next Verification Step

- Re-run code scanning for File Access rules on `feature/v1.2.0` and confirm reduction to mitigated/accepted-risk items only.
