# Contributing to drydock

Thanks for your interest in contributing to drydock!

## How to contribute

1. **Fork** the repository and create a branch from `main`.
2. **Make your changes** — keep commits focused and atomic.
3. **Run tests** before submitting:

   ```bash
   cd app && npm test
   ```

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

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
