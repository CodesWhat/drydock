# Contributing to drydock

Thanks for your interest in contributing to drydock!

## How to contribute

1. **Fork** the repository and create a branch from `main`.
2. **Make your changes** — keep commits focused and atomic.
3. **Run tests** before submitting:

   ```bash
   cd app && npm test
   ```

   ```bash
   ./scripts/run-load-test.sh
   ```

   The load test uses Artillery with `test.yml` against services from `test/ci-compose.yml`.
   Local runs pick a random free port by default; override with `DD_LOAD_TEST_PORT=3333 ./scripts/run-load-test.sh` when you need a fixed port.
   To choose a profile: `ARTILLERY_ENV=smoke ./scripts/run-load-test.sh` or `ARTILLERY_ENV=stress ./scripts/run-load-test.sh`.
   To persist the raw Artillery report JSON: `DD_LOAD_TEST_ARTIFACT_DIR=artifacts/load-test/local ./scripts/run-load-test.sh`.
   In CI pull requests, smoke metrics are compared to the latest `main` load-test baseline artifact in advisory mode.
   You can also run through npm scripts in `e2e/`: `npm run load:smoke`, `npm run load:ci`, `npm run load:stress`, `npm run load:rate-limit`.
   See `test/README.md` for load-test profile details.

4. **Open a pull request** against `main`.

## Coding standards

- **Language:** TypeScript (ESM, `NodeNext` module resolution)
- **Linter/formatter:** [Biome](https://biomejs.dev/) — run `npm run lint` and `npm run format`
- **Tests:** [Vitest](https://vitest.dev/) — new features and bug fixes should include tests
- **No transpiler:** The project compiles with `tsc` directly

## Reporting bugs

Open a [GitHub Issue](https://github.com/CodesWhat/drydock/issues) with steps to reproduce.

## Security vulnerabilities

**Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
