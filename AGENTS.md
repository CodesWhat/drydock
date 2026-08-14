# AGENTS.md

Guidance for coding agents working in this repository.

## What is Drydock?

Drydock is a Docker container update manager. It watches running containers, checks registries for newer image versions, and triggers notifications/actions when updates are available. It supports 23 registry providers, 20 trigger types, and a distributed controller-agent architecture (including native integration with [Portwing](https://github.com/CodesWhat/portwing) agents).

## Repository structure

This is a multi-workspace repo; each JS/TS workspace manages its own `package.json`:

- **`app/`** — Backend (TypeScript, Express, LokiJS). Compiles with `tsc` directly, no bundler.
- **`ui/`** — Frontend (Vue 3, Tailwind CSS 4, Vite SPA).
- **`e2e/`** — Cucumber API/stream contracts + Playwright browser tests.
- **`content/docs/`** — Versioned MDX documentation, the source of truth for published docs.
- **`apps/web/`** — Next.js marketing/docs site (`drydock-website`); consumes a generated copy of `content/docs/`.
- **`apps/demo/`** — Public demo instance (`drydock-demo`).
- **`scripts/`** — Repository maintenance scripts (release tooling, quality gates, workflow tests), each covered by `node:test`.
- **`.github/workflows/`** — CI, release, and security workflows.

## Build, test, and lint

```bash
# Backend — run from app/
npm run build           # tsc compilation + copy static assets
npm test                # vitest --coverage (100% threshold enforced; requires Node >=24)
npx vitest run path/to/file.test.ts   # single test file, no coverage
npm run lint             # biome check .
npm run lint:fix         # biome check --fix .

# Frontend — run from ui/
npm run build            # icons + fonts extraction, then vite build
npm run serve             # dev server on port 8080
npm run typecheck         # tsc --noEmit
npm run test:unit         # vitest run --coverage (100% threshold enforced)
npx vitest run tests/path/to/file.spec.ts   # single test file
npm run lint             # biome check .
npm run lint:fix         # biome check --fix .

# Static analysis from repo root (pre-push steps 4-5)
./scripts/qlty-check-gate.sh all
node scripts/qlty-smells-gate.mjs --scope=all || true   # advisory

# E2E — run from e2e/
npm run test:local        # Cucumber tests against a running instance

# Docker
docker build -t drydock:dev .
docker compose -f test/qa-compose.yml up -d   # QA environment on port 3333
```

Node.js **24+** is required (`engines` in root `package.json`, enforced again inside `app/`'s own `npm test` script).

## Architecture

### Component registry

The core pattern (`app/registry/`) loads providers dynamically from environment variables at startup:

```text
DD_REGISTRY_GHCR_PRIVATE_TOKEN=xxx       →  loads registries/providers/ghcr/Ghcr.ts
DD_NOTIFICATION_SLACK_MYSLACK_TOKEN=xxx  →  loads triggers/providers/slack/Slack.ts
DD_WATCHER_LOCAL_SOCKET=xxx              →  loads watchers/providers/docker/Docker.ts
```

Each component type (watcher, registry, trigger, authentication) extends a base `Component` class with `init()`, `deregister()`, and type-specific methods.

### Subsystems

- **Watchers** (`app/watchers/`) — monitor containers via the Docker socket, reading `dd.watch`/`dd.tag.*` labels.
- **Registries** (`app/registries/`) — query image registries for available tags; 23 providers share auth patterns via `BaseRegistry`.
- **Triggers** (`app/triggers/`) — send notifications or execute actions on update; category-scoped `DD_ACTION_*`/`DD_NOTIFICATION_*`. The legacy `DD_TRIGGER_*` env vars and `dd.trigger.*` labels are removed as of v1.7.0 — a leftover `DD_TRIGGER_*` variable now fails startup; see `DEPRECATIONS.md`.
- **Store** (`app/store/`) — LokiJS in-memory database, persisted to `/store/dd.json`.
- **Agents** (`app/agent/`) — controller-agent distributed architecture; agents run remote watchers/triggers, including Portwing edge/standard agents.
- **API** (`app/api/`) — Express REST API with SSE for real-time updates.

Configuration is env-var only, `DD_` prefix, nested via underscores (e.g. `DD_REGISTRY_HUB_PUBLIC_AUTH`); secret-file support via `DD_PASSWORD__FILE`.

## Testing patterns

- Vitest with globals enabled — no need to import `describe`, `test`, `expect`, `vi`.
- `vi.mock()` factories are hoisted above imports; use `vi.hoisted()` for values a mock factory needs.
- Backend tests typically mock the logger:

  ```ts
  vi.mock('../../log/index.js', () => ({
    default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
  }));
  ```

## Coverage policy

**100% line/branch/function/statement coverage is enforced for both `app/` and `ui/`.** This is a hard gate, not a target — the pre-push `coverage` step and CI both fail under it. External contributors aren't expected to hit this bar; per `CONTRIBUTING.md`, the maintainer brings PRs up to 100% during merge.

When coverage fails, read `.coverage-gaps.json` (gitignored, written by `scripts/coverage-gaps.mjs`) for the exact files, uncovered lines, and branch ids, parsed from `lcov.info`.

## Commit convention

Plain Conventional Commits, no emoji: `<type>(<scope>): <description>`

| Type | Use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | UI/cosmetic changes |
| `refactor` | Refactor (also covers code removal) |
| `perf` | Performance improvement |
| `test` | Adding/updating tests |
| `build` | Build system or dependency changes |
| `ci` | CI/CD configuration changes |
| `chore` | Tooling, config, misc |
| `revert` | Intentional revert |

Add `!` before the colon (`feat(api)!: drop v1 tokens`), or a `BREAKING CHANGE:` footer, for a breaking change. Enforced by the `commit-msg` hook (`scripts/validate-commit-msg.mjs`); on failure it prints an explicit amend command.

## Pre-push checks (Lefthook)

`git push` runs a piped (sequential, fail-fast) pipeline that takes about **5 minutes end to end**. In order:

1. `clean-tree` — rejects uncommitted changes (CI only ever sees committed state)
2. `ts-nocheck` — checks for `@ts-nocheck` directives against the allowlist
3. `biome` — lint/format via `npx biome check .`
4. `qlty` — static analysis via `./scripts/qlty-check-gate.sh all` (medium+ severity gate, budgeted at **4 minutes**)
5. `qlty-smells` — code-smell advisory scan (non-blocking)
6. `scripts-test` — `node --test scripts/*.test.mjs`
7. `workflow-tests` — `npm run test:workflows` (CI/workflow invariants, outside the app suite)
8. `typecheck-ui` — `npm run typecheck --prefix ui`
9. `web-scripts-test` — `npm run test:scripts --prefix apps/web`, only when a push touches `apps/web/**`
10. `coverage` — sharded `app`+`ui` parallel vitest with the 100% threshold above (takes roughly **210 seconds**); on failure writes `.coverage-gaps.json`
11. `build` — sharded `app`+`ui` parallel `tsc`/`vite`, no tests (they already ran in step 10)
12. `docker-build` — optional, only when `DD_LOCAL_DOCKER=1`
13. `zizmor` — GitHub Actions workflow security scan, only when `.github/workflows/*.yml` changed and `zizmor` is installed

Coverage runs before build so tests execute exactly once per push, and a coverage failure surfaces before a slower build failure would bury it.

**E2E (Cucumber) and Playwright are intentionally not in pre-push.** They run in `ci-verify.yml`/`e2e-playwright.yml` on the same commit a few minutes later, and are too slow and Docker-stateful for every local push. Run them directly first if you want the signal locally: `scripts/run-e2e-tests.sh` and `scripts/run-playwright-qa.sh` (referenced from `lefthook.yml`).

Never use `--no-verify`. If a hook fails, fix the root cause — that's what it's there to catch before CI does.

## Merging

Pull requests are **squash-only** — the repo has merge commits and rebase merges disabled. Don't rely on `git merge-base --is-ancestor` for anything branch-related in this repo; every merge to `main` mints a new commit that `dev/vX.Y` never had, so ancestry checks fail even on a fully in-sync branch. Compare trees instead (`git diff --quiet <a> <b>`) — see `RELEASING.md` for where this matters.

## Release & branch model

Feature work and fixes land on `dev/vX.Y` via PR — never target `main` directly (see `CONTRIBUTING.md`). Cutting an actual release (`main` sync, RC/GA tagging, the soak requirement) is a maintainer operation documented in `RELEASING.md`.

## Local planning archive

Longer-form working notes and the roadmap tracker live under `.planning/` at the **bare repo root** (`~/code/codeswhat/drydock/.planning/`, not inside any worktree) and are gitignored — never reference their contents in committed files. The committed roadmap summary lives in `README.md`.

## Key constraints

- Biome is a direct devDependency in the root workspace; qlty handles all other linters (actionlint, checkov, dockerfmt, hadolint, markdownlint, osv-scanner, shellcheck, shfmt, trivy, trufflehog, yamllint) but not biome — qlty's biome integration doesn't reliably apply fixes.
- `content/docs/` is the source of truth for published docs; the generated copy under `apps/web/content/docs/` is gitignored.
- `CHANGELOG.md` at the repo root is the single source of truth for the changelog.
- Regex from user config (tag include/exclude/transform) is compiled via `re2js` for linear-time execution — never introduce a raw `RegExp` on user-supplied patterns.
