# Drydock Benchmark Suite

Standalone microbenchmarks. Run from the repo root with `node scripts/bench/<name>.mjs`.
Benchmarks that import `app/dist` require a fresh backend build first: `cd app && npm run build && cd ..`.
Purely synthetic benches, such as `registry-rate.mjs`, can run without building the app.

## Benches

### `watcher-api-hotspots.mjs`

Measures the four watcher/agents API code paths (GET /api/watchers, GET /api/agents stats, AgentsView log prefetch, ServersView mount) before and after the hotspot fix. Fixture: 3 agents × 5 watchers × 4 containers (60 total), synthetic 30ms LAN RTT. Run when touching watcher or agent API response handlers.

```bash
node scripts/bench/watcher-api-hotspots.mjs
```

### `store-read-path.mjs`

Measures `getContainersRaw` and `buildContainerDashboardSummary` against 88 containers in the real Loki in-memory store. Run when touching the store read path, container validation, or the dashboard summary handler.

```bash
node scripts/bench/store-read-path.mjs
```

### `dashboard-summary.mjs`

Measures dashboard summary computation (4-pass vs single-pass), container clone cost (spread+structuredClone vs structuredClone only), and `tagPinned` getter vs data property access across 88 containers. Run when touching `buildContainerDashboardSummary`, `cloneContainer`, or `isTagPinned`.

```bash
node scripts/bench/dashboard-summary.mjs
```

### `registry-rate.mjs`

Simulates the request volume Cesc1986's 24-container fleet (14 Docker Hub, 10 GHCR) generates at hourly vs 6-hourly cron cadence. Validates that the rc.21 cron default change brings Docker Hub usage below the 200 req/6h authenticated limit. No real network calls.

```bash
node scripts/bench/registry-rate.mjs
```

### `aggregator-tick.mjs`

Measures `calculateContainerStatsSnapshot` (the hot inner function of `ContainerStatsAggregator`) across fleet sizes of 10, 50, 100, 500, and 1000 containers. Reports median/p95/max ms per tick and μs per container. Run when touching `app/stats/calculation.ts` or `app/stats/aggregator.ts`.

```bash
node scripts/bench/aggregator-tick.mjs
```

### `lock-manager.mjs`

Validates `LockManager` and `Semaphore` concurrency behavior: distinct-key acquires run in parallel (~50ms for N=10), same-key acquires serialize (~500ms for N=10), and `Semaphore(4)` batches 16 acquirers into 4 rounds (~200ms). Exits 1 if any scenario falls outside its expected range.

```bash
node scripts/bench/lock-manager.mjs
```

## Running all benches

```bash
for b in scripts/bench/*.mjs; do node "$b"; done
```
