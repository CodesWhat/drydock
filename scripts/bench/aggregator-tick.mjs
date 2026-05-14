#!/usr/bin/env node
// Validates rc.17's ContainerStatsAggregator hot path.
// Benches calculateContainerStatsSnapshot (the innermost computation inside
// each aggregator tick) across fleet sizes: 10, 50, 100, 500, 1000 containers.
//
// The aggregator itself is async and watcher-coupled, so we bench the hot
// inner function directly — that's where all the arithmetic lives.
//
// Run as: node scripts/bench/aggregator-tick.mjs

import { performance } from 'node:perf_hooks';
import { calculateContainerStatsSnapshot } from '../../app/dist/stats/calculation.js';

const FLEET_SIZES = [10, 50, 100, 500, 1000];
const ITERATIONS = 200;

// Build a deterministic Docker stats payload shaped like the real Docker API.
// CPU fields use a delta-based model: previousStats has lower totals so the
// calculation produces a non-zero cpuPercent.
function buildStats(containerId, tick) {
  const cpuBase = BigInt(containerId.charCodeAt(0)) * 1_000_000_000n;
  const systemBase = 100_000_000_000n;
  const tickOffset = BigInt(tick) * 500_000n;

  return {
    cpu_stats: {
      online_cpus: 4,
      cpu_usage: {
        total_usage: Number(cpuBase + tickOffset + 50_000_000n),
        percpu_usage: [1, 2, 3, 4].map((i) => Number(cpuBase / 4n + tickOffset / 4n + BigInt(i) * 1_000_000n)),
      },
      system_cpu_usage: Number(systemBase + tickOffset * 8n),
    },
    precpu_stats: {
      online_cpus: 4,
      cpu_usage: {
        total_usage: Number(cpuBase + tickOffset),
        percpu_usage: [1, 2, 3, 4].map((i) => Number(cpuBase / 4n + BigInt(i) * 1_000_000n)),
      },
      system_cpu_usage: Number(systemBase + tickOffset * 7n),
    },
    memory_stats: {
      usage: 256 * 1024 * 1024 + (containerId.charCodeAt(0) * 1024 * 1024),
      limit: 2 * 1024 * 1024 * 1024,
    },
    networks: {
      eth0: {
        rx_bytes: 1024 * 1024 * tick,
        tx_bytes: 512 * 1024 * tick,
      },
    },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: 'read', value: 4096 * tick },
        { op: 'write', value: 8192 * tick },
      ],
    },
  };
}

function buildFleet(size) {
  const containers = [];
  for (let i = 0; i < size; i++) {
    const id = `container-${String(i).padStart(6, '0')}`;
    containers.push({
      id,
      current: buildStats(id, 2),
      previous: buildStats(id, 1),
    });
  }
  return containers;
}

function runTickOnFleet(fleet) {
  const nowMs = Date.now();
  const results = [];
  for (const { id, current, previous } of fleet) {
    results.push(calculateContainerStatsSnapshot(id, current, previous, nowMs));
  }
  return results;
}

function percentile(sorted, p) {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function fmtMs(n) {
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}

function main() {
  console.log('\n## Aggregator tick hot-path bench — rc.17 ContainerStatsAggregator\n');
  console.log(
    `Benching calculateContainerStatsSnapshot across fleet sizes (${ITERATIONS} iterations each).\n`,
  );

  const col0 = 'Fleet size'.padEnd(12);
  const col1 = 'Median ms'.padEnd(12);
  const col2 = 'p95 ms'.padEnd(10);
  const col3 = 'Max ms'.padEnd(10);
  const col4 = 'μs/container';
  console.log(`| ${col0} | ${col1} | ${col2} | ${col3} | ${col4} |`);
  console.log(`| ------------ | ------------ | ---------- | ---------- | ------------ |`);

  for (const size of FLEET_SIZES) {
    const fleet = buildFleet(size);

    // Warm up
    runTickOnFleet(fleet);

    const runs = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      runTickOnFleet(fleet);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);

    const median = percentile(runs, 0.5);
    const p95 = percentile(runs, 0.95);
    const max = runs[runs.length - 1];
    const usPerContainer = ((median / size) * 1000).toFixed(1);

    console.log(
      `| ${String(size).padEnd(12)} | ${fmtMs(median).padEnd(12)} | ${fmtMs(p95).padEnd(10)} | ${fmtMs(max).padEnd(10)} | ${usPerContainer.padStart(12)} |`,
    );
  }

  console.log('');

  // Verify output is sensible for a single container
  const sample = buildFleet(1)[0];
  const snap = calculateContainerStatsSnapshot(sample.id, sample.current, sample.previous, Date.now());
  console.log('Sanity check (1 container):');
  console.log(`  cpuPercent=${snap.cpuPercent}`);
  console.log(`  memoryUsageBytes=${snap.memoryUsageBytes.toLocaleString()}`);
  console.log(`  memoryPercent=${snap.memoryPercent}`);
  console.log(`  networkRxBytes=${snap.networkRxBytes.toLocaleString()}`);
  console.log(`  blockReadBytes=${snap.blockReadBytes.toLocaleString()}`);
  console.log('');
}

main();
