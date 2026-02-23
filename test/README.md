# Test Assets

## Load Testing (Artillery)

Load-test scenarios live in `test.yml`, `test-behavior.yml`, and `test-rate-limit.yml` and run against the stack in `test/ci-compose.yml`.

### Profiles

- `smoke`: low traffic sanity check (used for pull requests)
- `ci`: moderate traffic regression profile (used for push, advisory, optimized for faster CI runtime)
- `behavior`: feature-behavior profile for SSE reconnect, log routes, and write-path checks
- `stress`: higher traffic profile for manual pressure testing
- `ratelimit`: focused burst profile that validates `429` behavior for scan endpoint limits

### Local commands

From repo root:

```bash
./scripts/run-load-test.sh
ARTILLERY_ENV=smoke ./scripts/run-load-test.sh
ARTILLERY_FILE=./test-behavior.yml ARTILLERY_ENV=behavior ./scripts/run-load-test.sh
ARTILLERY_ENV=stress ./scripts/run-load-test.sh
ARTILLERY_FILE=./test-rate-limit.yml ARTILLERY_ENV=ratelimit ./scripts/run-load-test.sh
DD_LOAD_TEST_PORT=3333 ./scripts/run-load-test.sh
```

Write a JSON report file:

```bash
DD_LOAD_TEST_ARTIFACT_DIR=artifacts/load-test/local ./scripts/run-load-test.sh
```

Summarize a saved JSON report (including status mix + slow endpoints):

```bash
./scripts/summarize-load-test-report.sh artifacts/load-test/local/<report>.json "Load Test (Local)"
```

From `e2e/`:

```bash
npm run load:smoke
npm run load:behavior
npm run load:ci
npm run load:stress
npm run load:rate-limit
```

### Notes

- The runner prefers the pinned `e2e` Artillery install.
- If not available, it falls back to an explicit pinned `npx` version.
- The load-test stack is isolated via a dedicated Compose project name to avoid collisions with other local test stacks.
- The runner auto-selects a free random host port when `DD_LOAD_TEST_PORT` is not set.
- The rate-limit profile resolves `containerId` through `test/load-test.processor.cjs` before measured requests so scan endpoint p95/p99 is not skewed by `/api/containers/watch` setup latency.
- In CI, the workflow enables Buildx + GHA cache to speed repeated image builds.
- CI uploads Artillery JSON reports as workflow artifacts and posts a short p95/p99/request-rate summary in the job summary.
- PR smoke CI also performs a regression check against the latest non-expired `load-test-ci` artifact from `main`.
- Regression check defaults to advisory mode with drift thresholds: `p95 <= +20%`, `p99 <= +25%`, `request_rate >= -15%`.
- To enforce the gate, set `DD_LOAD_TEST_REGRESSION_ENFORCE=true` in the CI step environment.
- You can run the same check locally with `./scripts/check-load-test-regression.sh <current.json> <baseline.json>`.
- Correctness checks (5xx, failed VUs, and optional 429 bounds) are handled by `./scripts/check-load-test-correctness.sh <report.json> "<title>"`.
- Staged enforcement: pull requests run load-test checks in advisory mode; push runs enforce correctness checks while regression drift stays advisory.
