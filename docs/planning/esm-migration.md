# ESM Migration Workstream

Last updated: 2026-02-09

## Goal

Migrate `app` from `CommonJS` runtime assumptions to a clean `ESM` baseline, then remove temporary compatibility workarounds.

## Baseline Audit

Run:

```bash
./scripts/esm-readiness.sh
```

Current baseline (2026-02-09):

- Runtime CJS globals in app code:
  - none (direct `__dirname` usage removed from runtime files)
- Known ESM interop workaround:
  - none (OIDC adapter bridge removed on `codex/esm-cutover-app`)
- CJS tooling config files:
  - `app/jest.config.cjs`
  - `ui/jest.config.js`
  - `ui/babel.config.js`
  - `ui/vue.config.js`
- Jest major constraint:
  - `ui` depends on `@vue/vue3-jest` (`29.x`), so monorepo stays on `jest`/`babel-jest` `29.x` for now.

## Phase 0 Execution Checklist

- [x] Add migration roadmap entry and rollback list in `docs/planning/README.md`.
- [x] Add repeatable readiness audit script (`scripts/esm-readiness.sh`).
- [x] Remove direct runtime `__dirname` usage from `app` by centralizing path resolution in `app/runtime/paths.ts` (single ESM swap point).
- [x] Isolate OIDC `openid-client` bridge behind a dedicated adapter module (single revert point).
- [x] Add CI non-blocking ESM readiness job (report-only) using `scripts/esm-readiness.sh`.
- [x] Switch `app/runtime/paths.ts` to `import.meta.url` + `fileURLToPath` after module target changes.
- [x] Define ESM cutover branch plan (phase gates + rollback plan).

## Cutover Branch Plan

- Branch name: `codex/esm-cutover-app`
- Scope: `app` module/runtime conversion first; keep `ui` module format unchanged in this phase.
- Entry criteria:
  - `./scripts/esm-readiness.sh --strict` passes on `main`.
  - OIDC flow smoke-tested in current CJS baseline.
- Execution sequence:
  - [x] Flip `app/tsconfig.json` to `module=NodeNext` and `moduleResolution=NodeNext`.
  - [x] Move runtime path helpers (`app/runtime/paths.ts`) to `import.meta.url` + `fileURLToPath`.
  - [x] Replace OIDC adapter bridge with direct ESM import path.
  - [x] Update app test runtime config to execute ESM modules reliably.
- Merge gates:
  - `cd app && npm run build`
  - `cd app && npm test`
  - `cd ui && npm run test:unit`
  - Manual OIDC redirect/callback verification.
  - No readiness regressions (`./scripts/esm-readiness.sh --strict`).
- Rollback plan:
  - Keep migration commits split by concern (tsconfig/runtime paths/OIDC/Jest).
  - If cutover fails, revert branch and keep only Phase 0 groundwork (`scripts/esm-readiness.sh`, runtime path centralization).

## Phase Gates (Before Switching module target)

- `app` build and tests pass.
- `ui` build and tests pass.
- OIDC auth flow validated manually (redirect + callback).
- No new runtime CJS patterns introduced in `app` (tracked by readiness script).

## Revert Targets

See `Compatibility Workarounds To Revert` in:

- `docs/planning/README.md`

## Manual OIDC Smoke Checklist (Cutover Gate)

Use a real OIDC provider configuration and verify:

1. Open login UI and trigger OIDC auth (`/auth/oidc/{name}/redirect` route responds with a URL).
2. Follow redirect to IdP and authenticate successfully.
3. Callback endpoint (`/auth/oidc/{name}/cb`) completes without `checks.state` or PKCE errors.
4. App session is established (authenticated API call succeeds).
5. Logout path behaves as expected when IdP exposes end-session URL.
