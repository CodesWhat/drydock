# Contributing to Drydock

Thanks for your interest in contributing! Whether it's a bug fix, new feature, documentation improvement, or something else — all contributions are welcome.

Questions or ideas? Start a [GitHub Discussion](https://github.com/CodesWhat/drydock/discussions) or open an [issue](https://github.com/CodesWhat/drydock/issues).

## How contributions work

Drydock maintains strict quality gates (100% code coverage, multi-stage CI pipeline, mutation testing). **You don't need to worry about any of that.** Here's how it works:

1. **You write the code** — focus on the feature or fix itself
2. **Open a PR** — even if it's rough, incomplete, or has no tests
3. **The maintainer handles the rest** — testing, coverage, lint fixes, docs updates, and final polish

Your commits keep your Git author attribution. If the maintainer needs to restructure your work, they'll use `Co-Authored-By` to preserve credit.

**The goal is zero friction for contributors.** Don't let the CI pipeline scare you — it runs on PRs for visibility, but passing everything is the maintainer's job, not yours.

## Where to help

Drydock moves fast — open issues tend to get fixed quickly. The best way to find work:

- **Open a [Discussion](https://github.com/CodesWhat/drydock/discussions)** and say what you're interested in. We'll scope something that fits your experience level.
- **Browse the [Ideas category](https://github.com/CodesWhat/drydock/discussions/categories/ideas)** — feature requests from users that haven't been built yet.
- **Add a new trigger provider** — the `app/triggers/providers/` directory has 20 examples to follow. Adding support for a new notification service (Pushbullet, Gotify, etc.) is self-contained and well-patterned.
- **Documentation** — improvements to `content/docs/` are always welcome and need zero backend knowledge.
- **Check for [`good first issue`](https://github.com/CodesWhat/drydock/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)** labels when they exist, but don't wait for them.

## Getting started

1. **Fork** the repository and clone your fork
2. **Use Node.js 24+**:

   ```bash
   nvm use || nvm install
   ```

3. **Install dependencies** — each workspace manages its own:

   ```bash
   cd app && npm install
   cd ui && npm install
   ```

4. **Create a branch** from the appropriate base:
   - Bug fixes: branch from `main`
   - New features: branch from the active feature branch (check open branches)

## Quick development loop

### Backend (`app/`)

```bash
npm run build                           # TypeScript compilation
npx vitest run path/to/file.test.ts     # Run a single test file (fast)
npx vitest run --reporter=verbose       # Run all tests (no coverage)
npm run lint:fix                        # Auto-fix formatting
```

### Frontend (`ui/`)

```bash
npm run serve                           # Dev server on port 8080
npx vitest run tests/path/to/file.spec.ts   # Single test file
npm run lint:fix                        # Auto-fix formatting
```

### Docker QA environment

```bash
docker build -t drydock:dev .
docker compose -f test/qa-compose.yml up -d   # Starts on port 3333
```

You don't need to run the full test suite, coverage gates, or e2e tests locally. Just make sure your code compiles (`npm run build`) and your specific tests pass. The maintainer handles the rest.

## Architecture overview

Drydock is a Docker container update manager with a dynamic component registry:

```text
app/                        # Backend (TypeScript, Express, LokiJS)
├── watchers/providers/     # Monitor containers (Docker socket)
├── registries/providers/   # Query image registries (23 providers)
├── triggers/providers/     # Send notifications / actions (20 providers)
├── api/                    # REST API + SSE
├── store/                  # LokiJS in-memory database
├── model/                  # TypeScript interfaces
└── agent/                  # Distributed controller-agent architecture

ui/                         # Frontend (Vue 3, Tailwind CSS 4, Vite)
├── src/views/              # Page components
├── src/components/         # Shared components (AppButton, AppBadge, etc.)
├── src/composables/        # Vue composables
├── src/services/           # API client layer
└── src/utils/              # Helpers and mappers

content/docs/               # Documentation (MDX, versioned)
e2e/                        # End-to-end tests (Cucumber + Playwright)
```

**Component registry pattern:** Components are loaded dynamically from environment variables:

```text
DD_REGISTRY_GHCR_PRIVATE_TOKEN=xxx  →  loads registries/providers/ghcr/Ghcr.ts
DD_TRIGGER_SLACK_MYSLACK_TOKEN=xxx  →  loads triggers/providers/slack/Slack.ts
DD_WATCHER_LOCAL_SOCKET=xxx         →  loads watchers/providers/docker/Docker.ts
```

Each component type extends a base class with `init()`, `deregister()`, and type-specific methods.

## Code style

- **Language:** TypeScript (ESM, `NodeNext` module resolution)
- **Linter/formatter:** [Biome](https://biomejs.dev/) — run `npm run lint:fix` to auto-fix
- **Line width:** 100, single quotes
- **No transpiler:** compiles with `tsc` directly

## Commit convention

We use **Gitmoji + Conventional Commits**:

```text
<emoji> <type>(<scope>): <description>
```

| Emoji | Type | Use |
|---|---|---|
| ✨ | `feat` | New feature |
| 🐛 | `fix` | Bug fix |
| 📝 | `docs` | Documentation |
| 💄 | `style` | UI/cosmetic changes |
| ♻️ | `refactor` | Code refactor (no feature/fix) |
| ⚡ | `perf` | Performance improvement |
| ✅ | `test` | Adding/updating tests |
| 🔧 | `chore` | Build, config, tooling |
| 🔒 | `security` | Security fix |
| ⬆️ | `deps` | Dependency upgrade |

Scope is optional. Subject line: imperative, lowercase, no trailing period.

```text
✨ feat(docker): add health check endpoint
🐛 fix: resolve socket EACCES (#38)
```

Don't stress about getting the emoji/format perfect — the commit-msg hook will tell you if something's off, and the maintainer can fix it during merge.

## Testing (optional for contributors)

Tests are welcome but **not required** in your PR. The maintainer will add or update tests to maintain 100% coverage.

If you do want to write tests:

- **Framework:** [Vitest](https://vitest.dev/) with globals — no need to import `describe`, `test`, `expect`, or `vi`
- **Run your test:** `npx vitest run path/to/your.test.ts`
- **Logger mock** (backend tests usually need this):

  ```ts
  vi.mock('../../log/index.js', () => ({
    default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
  }));
  ```

- **Gotcha:** `vi.mock()` factories are hoisted above imports — you can't use imported helpers inside them. Use `vi.hoisted()` for values needed in mock factories.

## Pull requests

- **Target:** `main` for bug fixes, the active feature branch for new features
- **Size:** Smaller is better — one concern per PR when possible
- **Tests/coverage:** Nice to have, not required. The maintainer handles it.
- **Docs:** If your change affects user-facing behavior, a docs update in the same PR is appreciated but not mandatory.
- **CI failures:** Don't worry about them. CI runs the full pipeline for visibility, but passing is the maintainer's responsibility.

Draft PRs are welcome if you want early feedback before finishing.

## Reporting bugs

Open a [GitHub Issue](https://github.com/CodesWhat/drydock/issues) with steps to reproduce.

## Security vulnerabilities

**Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).

---

## Maintainer reference

<details>
<summary>Full quality pipeline (maintainers only)</summary>

### Pre-push checks

[Lefthook](https://github.com/evilmartians/lefthook) runs a piped (sequential, fail-fast) pipeline on every `git push`:

| Priority | Step | What it does | On Failure |
|---|---|---|---|
| 0 | `clean-tree` | Rejects uncommitted changes | Fail |
| 1 | `ts-nocheck` | Checks for `@ts-nocheck` directives | Fail |
| 2 | `biome check` | Linting and formatting | Fail |
| 3 | `qlty` | Static analysis (medium+ severity gate) | Fail |
| 4 | `qlty-smells` | Code smell detection | Advisory |
| 5 | `build-and-test` | Parallel builds + tests WITHOUT coverage | Fail |
| 6 | `coverage` | 100% threshold enforcement | Fail |
| 7 | `e2e` | End-to-end Cucumber tests | Fail |
| 8 | `e2e-playwright` | Playwright browser tests | Fail |
| 9 | `zizmor` | GitHub Actions security scanning | Fail |

When coverage fails, `.coverage-gaps.json` contains exact files and uncovered lines.

### Coverage policy

100% line/branch/function/statement coverage is enforced for both `app/` and `ui/`. This is achievable because the project uses AI-assisted development for test generation. External contributors are not expected to meet this bar.

### Mutation testing

Stryker runs weekly (`.github/workflows/quality-mutation-weekly.yml`), advisory only. Use it as a quality signal, not a score target.

### Paid security scans

Snyk (Open Source, Code, Container, IaC) runs weekly via `.github/workflows/security-snyk-weekly.yml` to preserve monthly quotas.

</details>
