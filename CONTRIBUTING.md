# Contributing to Drydock

Thanks for your interest in contributing! Whether it's a bug fix, new feature, documentation improvement, or something else — all contributions are welcome.

Questions or ideas? Start a [GitHub Discussion](https://github.com/CodesWhat/drydock/discussions) or open an [issue](https://github.com/CodesWhat/drydock/issues).

## Getting started

1. **Fork** the repository and clone your fork.
2. **Use Node.js 24+** (required for local development and tests):

   ```bash
   nvm use || nvm install
   ```

3. **Install dependencies** — each workspace manages its own:

   ```bash
   cd app && npm install
   cd ui && npm install
   cd e2e && npm install
   ```

4. **Create a branch** from the appropriate base:
   - Bug fixes for the current release: branch from `main`
   - New features targeting the next release: branch from the active feature branch (check open branches for the current one)

## Development setup

### Backend (`app/`)

```bash
npm run build     # TypeScript compilation (tsc)
npm test          # Vitest with coverage (100% thresholds enforced)
npx vitest run path/to/file.test.ts   # Run a single test file
```

### Frontend (`ui/`)

```bash
npm run build       # Vite production build
npm run test:unit   # Vitest with coverage (100% thresholds enforced)
npm run serve       # Dev server on port 8080 (proxies API to backend)
```

### Docker QA environment

```bash
docker build -t drydock:dev .
docker compose -f test/qa-compose.yml up -d   # Starts on port 3333
```

## Code style

- **Language:** TypeScript (ESM, `NodeNext` module resolution)
- **Linter/formatter:** [Biome](https://biomejs.dev/) — direct devDependency in the root workspace. [Qlty](https://qlty.sh) runs all other linters (actionlint, shellcheck, trivy, etc.)
- **Line width:** 100
- **Quotes:** single quotes
- **No transpiler:** the project compiles with `tsc` directly

Run from any workspace:

```bash
npm run lint       # biome check .
npm run lint:fix   # biome check --fix .
npm run format     # biome format --write .
```

Or check everything from the repo root:

```bash
qlty check --all --no-progress
```

## Commit convention

We use **Gitmoji + Conventional Commits**:

```text
<emoji> <type>(<scope>): <description>
```

|Emoji|Type|Use|
|---|---|---|
|✨|`feat`|New feature|
|🐛|`fix`|Bug fix|
|📝|`docs`|Documentation|
|💄|`style`|UI/cosmetic changes|
|♻️|`refactor`|Code refactor (no feature/fix)|
|⚡|`perf`|Performance improvement|
|✅|`test`|Adding/updating tests|
|🔧|`chore`|Build, config, tooling|
|🔒|`security`|Security fix|
|⬆️|`deps`|Dependency upgrade|
|🗑️|`revert`|Revert a previous commit|

Scope is optional. Subject line should be imperative, lowercase, no trailing period.

```text
✨ feat(docker): add health check endpoint
🐛 fix: resolve socket EACCES (#38)
♻️ refactor(store): simplify collection init
```

## Testing

- **Framework:** [Vitest](https://vitest.dev/) with globals enabled — no need to import `describe`, `test`, `expect`, or `vi`
- **Coverage:** 100% thresholds enforced for both `app/` and `ui/` — new features and bug fixes must include tests
- **Shared helpers:** `app/test/helpers.ts` and `app/test/mock-constructor.ts`
- **Logger mock pattern** (used in most backend tests):

  ```ts
  vi.mock('../../log/index.js', () => ({
    default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
  }));
  ```

- **Mock hoisting constraint:** `vi.mock()` factory callbacks are hoisted above all imports. You **cannot** reference imported helpers inside them — only values from `vi.hoisted()` in the same file. Shared helpers can be used in test bodies and `beforeEach`, but not inside mock factories.

## Pre-push checks

[Lefthook](https://github.com/evilmartians/lefthook) runs a piped (sequential, fail-fast) pipeline on every `git push`:

|Priority|Step|What it does|On Failure|
|---|---|---|---|
|0|`clean-tree`|Block push if uncommitted changes exist|Fail|
|1|`ts-nocheck`|Rejects any `@ts-nocheck` directives|Fail|
|2|`biome`|Biome lint and format check|Fail|
|3|`qlty`|Full qlty lint pass (`qlty check --all`)|Fail|
|4|`build-and-test`|Parallel build + test for both `app/` and `ui/`|Fail|
|5|`e2e`|Cucumber E2E tests against a fresh Drydock instance|Fail|
|6|`zizmor`|GitHub Actions workflow linting (advisory, skipped if not installed)|Skip if not installed|

If lefthook passes locally, CI will pass. Fix any issues **before** pushing.

## Documentation

Documentation lives in `content/docs/` (MDX format, versioned by release) and is published to [getdrydock.com](https://getdrydock.com). When your code change affects user-facing behavior, include the corresponding documentation update in the same PR.

CHANGELOG and README updates should accompany each logical change — don't batch them separately.

## Pull requests

- **Target branch:** `main` for bug fixes on the current release; the active feature branch for new features
- Keep commits focused and atomic — one concern per commit
- Ensure all pre-push checks pass before opening a PR
- Include tests for new functionality and bug fixes
- Update documentation when changing user-facing behavior

## Reporting bugs

Open a [GitHub Issue](https://github.com/CodesWhat/drydock/issues) with steps to reproduce.

## Security vulnerabilities

**Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0](LICENSE).
