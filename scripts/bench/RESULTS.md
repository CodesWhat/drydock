# Benchmark Results

**Branch:** `feature/v1.5-rc21`
**Commit:** `0b51b07faf5af594f5157e3708cbcda6d2122812`
**Date:** 2026-05-14

## Headlines

- **rc.21 cron default cuts all registry chatter 6×**: hourly cadence puts drydock's authenticated Hub pull count at 84/6h (42% of the 200-pull ceiling, comfortable headroom either way); 6-hourly drops it to 14/6h. The headline benefit is the 6× cut in GHCR registry chatter (486 → 81 req/6h) and GitHub release-notes API calls (60 → 10 req/6h) — which is where Cesc1986 actually saw 429s in #342. Docker Hub's quota counts manifest HEADs only; auth and tag-list calls are not quota-counted and were never the breach.
- **GitHub REST API release-notes drops 60 → 10 req/6h** (0.2% → 0.0% of the 5k/hr ceiling). Combined with rc.20's GH-token fallback, this is the cleanest fix for the `release-notes.provider.github` rate-limited warnings Cesc was seeing every cron cycle.
- **LockManager correctness confirmed**: distinct-key acquires complete in ~50ms (parallel); same-key acquires complete in ~510ms (serialized, 10.1× slower); Semaphore(4) batches 16 acquirers into ~203ms (4 batches × 50ms). All scenarios PASS.
- **Aggregator tick scales linearly**: `calculateContainerStatsSnapshot` costs ~0.6–0.8 μs per container; a 1000-container fleet ticks in ~0.63ms median — under 1ms even at extreme scale.
- **tagPinned getter vs data property**: 660× faster to read a materialized data property (0.002ms) than a live regex-recompiling getter (1.05ms) across 88 containers. Container clone path 8.8× faster with structuredClone-only.

---

## watcher-api-hotspots

```text
## Watcher/agents API hotspot regression baseline

Fixtures: 3 agents × 5 watchers × 4 containers = 60 containers
Simulated LAN RTT: 30ms per HTTP RPC
Iterations per scenario: 5 (reported: median / min / max)

| Scenario                                   | Median ms | Min ms | Max ms |
| ------------------------------------------ | --------- | ------ | ------ |
| GET /api/watchers (before)                 |     31.13 |  30.36 |  31.21 |
| GET /api/watchers (after)                  |     0.023 |  0.008 |  0.091 |
| GET /api/agents stats (before)             |     0.073 |  0.054 |  0.278 |
| GET /api/agents stats (after)              |     0.006 |  0.006 |  0.074 |
| AgentsView mount logs fetch (before)       |     31.12 |  30.47 |  31.13 |
| AgentsView mount logs fetch (after)        |     0.000 |  0.000 |  0.043 |
| ServersView mount (before)                 |     61.98 |  61.41 |  62.32 |
| ServersView mount (after)                  |     31.11 |  30.24 |  31.12 |

### Speedups (before / after median)

- GET /api/watchers: 31.13ms → 0.023ms (1353.4×)
- GET /api/agents stats: 0.073ms → 0.006ms (12.4×)
- AgentsView mount logs: 31.12ms → 0.000ms (149592.4×)
- ServersView mount: 61.98ms → 31.11ms (2.0×)
```

---

## store-read-path

```text
## Store read-path regression baseline

Fixture: 88 validated containers in Loki memory store, transform-tag regex applied.

Per-call timings (cached query cache, clone + validate path):
  getContainersRaw({}):              median 0.00ms / p95 0.01ms / max 0.01ms (50 runs)
  buildContainerDashboardSummary:    median 4.332ms / p95 4.691ms / max 5.318ms (200 runs)

Summary computed from fixture:
  total=88
  running=66
  updatesAvailable=30
  hotUpdates=30
  matureUpdates=0
  securityIssues=0
  (sanity: list length 88, first tagPinned=true)
```

---

## dashboard-summary

```text
## Dashboard summary regression baseline

Fixtures: 88 containers (reporter topology), 200 iterations per scenario.

| Scenario                                               | Median ms | p95 ms | Min ms | Max ms |
| ------------------------------------------------------ | --------- | ------ | ------ | ------ |
| Dashboard summary (4-pass filter, before)              |     0.005 |  0.015 |  0.005 |  0.264 |
| Dashboard summary (single pass, after)                 |     0.004 |  0.011 |  0.001 |  0.023 |
| Container clone (spread + structuredClone, before)     |      1.54 |   2.20 |   1.33 |   2.59 |
| Container clone (structuredClone only, after)          |     0.176 |  0.211 |  0.167 |  0.240 |
| Read tagPinned on all containers (getter, before)      |      1.05 |   1.14 |  0.995 |   1.32 |
| Read tagPinned on all containers (data prop, after)    |     0.002 |  0.002 |  0.000 |  0.015 |

### Speedups (before / after median)

- Dashboard summary: 0.005ms → 0.004ms (1.4×)
- Container clone (88 containers): 1.54ms → 0.176ms (8.8×)
- tagPinned read fan-out: 1.05ms → 0.002ms (660.2×)
```

---

## registry-rate

```text
## Registry rate-limit bench — rc.21 cron default validation

Fleet: 24 containers (14 Docker Hub, 10 GHCR)
  immich-server-class: 24 tag pages each

| Counter                                  | Hourly (6 cycles)      | 6-Hourly (1 cycle)     | Speedup         |
| ---------------------------------------- | ---------------------- | ---------------------- | --------------- |
| Hub manifest HEADs (quota-counted)       | 84                     | 14                     | 6×              |
| Hub auth + tag-list (not quota-counted)  | 222                    | 37                     | 6×              |
| GHCR registry calls (OCI; no pub. quota) | 486                    | 81                     | 6×              |
| GitHub API release-notes (5k/hr limit)   | 60                     | 10                     | 6×              |

### Rate-limit headroom (6-hour window)

Docker Hub pull quota (manifest HEAD only — auth/tag-list calls are NOT quota-counted):
  Authenticated ceiling (200/6h):
    Hourly cadence:   84 pulls → 42.0% used, 116 req headroom (58.0% free)
    6-hourly cadence: 14 pulls → 7.0% used, 186 req headroom (93.0% free)
  Anonymous ceiling (100/6h):
    Hourly cadence:   84 pulls → 84.0% used, 16 req headroom (16.0% free)
    6-hourly cadence: 14 pulls → 14.0% used, 86 req headroom (86.0% free)

Docker Hub auth + tag-list (hubOther — no documented quota; soft rate-limited):
  Hourly cadence:   222 req
  6-hourly cadence: 37 req

GHCR registry (no documented per-account quota for authenticated users;
  anonymous traffic is rate-limited at undocumented thresholds — source of Cesc's 429s):
  Hourly cadence:   486 req
  6-hourly cadence: 81 req
  Speedup: 6× fewer requests against GHCR per 6h window

GitHub REST API release-notes (5,000/hr authenticated → 30,000/6h ceiling):
  Hourly cadence:   60 req → 0.2% used, 29940 req headroom (99.8% free)
  6-hourly cadence: 10 req → 0.0% used, 29990 req headroom (100.0% free)

### Summary

- Hub pull quota (auth 200/6h): hourly=84 pulls (42.0%), 6-hourly=14 pulls (7.0%) — comfortable headroom at both cadences
- Hub pull quota (anon 100/6h): hourly=84 pulls (84.0%), 6-hourly=14 pulls (14.0%) — comfortable headroom at both cadences
- GHCR registry calls: 486 → 81 per 6h window (6× reduction) — where Cesc's 429s originated (#342)
- GitHub API release-notes: 60 → 10 per 6h window (6× reduction, 0.2% → 0.0% of ceiling)
- 6× reduction across all counters — primary benefit is cutting GHCR + GitHub API chatter, not Hub pull quota headroom
```

---

## aggregator-tick

```text
## Aggregator tick hot-path bench — rc.17 ContainerStatsAggregator

Benching calculateContainerStatsSnapshot across fleet sizes (200 iterations each).

| Fleet size   | Median ms    | p95 ms     | Max ms     | μs/container |
| ------------ | ------------ | ---------- | ---------- | ------------ |
| 10           | 0.0081       | 0.018      | 0.242      |          0.8 |
| 50           | 0.034        | 0.055      | 0.112      |          0.7 |
| 100          | 0.065        | 0.083      | 0.275      |          0.6 |
| 500          | 0.311        | 0.363      | 0.536      |          0.6 |
| 1000         | 0.632        | 0.717      | 0.998      |          0.6 |

Sanity check (1 container):
  cpuPercent=50
  memoryUsageBytes=372,244,480
  memoryPercent=17.33
  networkRxBytes=2,097,152
  blockReadBytes=8,192
```

---

## lock-manager

```text
## Lock-manager concurrency bench — rc.17 LockManager + Semaphore

Hold duration per acquirer: 50ms, N=10 concurrent acquirers.

### Scenario 1: Unrelated containers (N distinct keys)

  Expected: parallel → ~50ms total
  Observed: 50ms  [expected 50–100ms]  PASS

### Scenario 2: Same compose project (same key, N=10 times)

  Expected: serialized → ~500ms total
  Observed: 510ms  [expected 400–700ms]  PASS

### Scenario 3: Global Semaphore(4), 16 concurrent acquirers

  Expected: 4 batches of 4 → ~200ms total
  Observed: 203ms  [expected 160–280ms]  PASS

### Summary

| Scenario                         | Observed ms | Expected range ms | Result |
| -------------------------------- | ----------- | ----------------- | ------ |
| Distinct keys (parallel)         |          50 | 50–100           | PASS   |
| Same key (serialized)            |         510 | 400–700           | PASS   |
| Semaphore(4) cap (16 acquirers)  |         203 | 160–280           | PASS   |

Serial/parallel speedup: 10.1× slower when same key
Overall: ALL PASS
```
