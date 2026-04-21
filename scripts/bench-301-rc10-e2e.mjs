#!/usr/bin/env node
// End-to-end drydock #301 rc.10 read-path bench. Boots the real in-memory
// store, seeds 88 validated containers (same shape validate() produces in
// production), and times GET /api/containers plus the dashboard summary
// handler against that fixture. Intended to confirm that the rc.10
// regression is actually gone — not a unit test.
//
// Run as: node scripts/bench-301-rc10-e2e.mjs

import { performance } from 'node:perf_hooks';
import { getContainersRaw, insertContainer } from '../app/dist/store/container.js';
import { init as storeInit } from '../app/dist/store/index.js';
import { buildContainerDashboardSummary } from '../app/dist/util/container-summary.js';

const CONTAINERS = 88;
const LIST_ITERATIONS = 50;
const SUMMARY_ITERATIONS = 200;

function buildFixture(i) {
  return {
    id: `${-i}`.padStart(12, '0'),
    name: `container-${i}`,
    watcher: 'docker.local',
    includeTags: undefined,
    excludeTags: undefined,
    transformTags: '^([0-9]+)\\.([0-9]+)\\.([0-9]+)(?:-(.+))?$ => $1.$2.$3',
    linkTemplate: undefined,
    displayName: undefined,
    displayIcon: undefined,
    status: i % 4 === 0 ? 'exited' : 'running',
    image: {
      id: `sha256:${i.toString(16).padStart(8, '0')}`,
      registry: {
        name: 'hub',
        url: 'https://registry-1.docker.io/v2',
      },
      name: `image-${i}`,
      tag: { value: `1.${i}.0-arm64`, semver: true },
      digest: {
        watch: i % 3 === 0,
        value: `sha256:${i.toString(16).padStart(64, '0')}`,
      },
      architecture: 'arm64',
      os: 'linux',
      created: '2026-04-01T00:00:00.000Z',
    },
    result:
      i % 3 === 0
        ? {
            tag: `1.${i + 1}.0-arm64`,
            digest: `sha256:${(i + 100).toString(16).padStart(64, '0')}`,
            created: '2026-04-15T00:00:00.000Z',
          }
        : undefined,
    error: undefined,
  };
}

async function main() {
  process.env.DD_LOG_LEVEL = 'error';

  await storeInit({ memory: true });

  for (let i = 0; i < CONTAINERS; i++) {
    insertContainer(buildFixture(i));
  }

  // Warm the query cache.
  getContainersRaw({});

  const listRuns = [];
  for (let i = 0; i < LIST_ITERATIONS; i++) {
    const t0 = performance.now();
    getContainersRaw({});
    listRuns.push(performance.now() - t0);
  }
  listRuns.sort((a, b) => a - b);

  const summaryRuns = [];
  for (let i = 0; i < SUMMARY_ITERATIONS; i++) {
    const list = getContainersRaw({});
    const t0 = performance.now();
    buildContainerDashboardSummary(list);
    summaryRuns.push(performance.now() - t0);
  }
  summaryRuns.sort((a, b) => a - b);

  const list = getContainersRaw({});
  const summary = buildContainerDashboardSummary(list);

  const listMed = listRuns[Math.floor(listRuns.length / 2)];
  const listP95 = listRuns[Math.floor(listRuns.length * 0.95)];
  const listMax = listRuns[listRuns.length - 1];
  const sumMed = summaryRuns[Math.floor(summaryRuns.length / 2)];
  const sumP95 = summaryRuns[Math.floor(summaryRuns.length * 0.95)];
  const sumMax = summaryRuns[summaryRuns.length - 1];

  console.log('\n## Drydock #301 rc.10 end-to-end read-path bench\n');
  console.log(
    `Fixture: ${CONTAINERS} validated containers in Loki memory store, transform-tag regex applied.\n`,
  );
  console.log(`Per-call timings (cached query cache, clone + validate path):`);
  console.log(
    `  getContainersRaw({}):              median ${listMed.toFixed(2)}ms / p95 ${listP95.toFixed(2)}ms / max ${listMax.toFixed(2)}ms (${LIST_ITERATIONS} runs)`,
  );
  console.log(
    `  buildContainerDashboardSummary:    median ${sumMed.toFixed(3)}ms / p95 ${sumP95.toFixed(3)}ms / max ${sumMax.toFixed(3)}ms (${SUMMARY_ITERATIONS} runs)\n`,
  );

  console.log(`Summary computed from fixture:`);
  console.log(`  total=${summary.status.total}`);
  console.log(`  running=${summary.status.running}`);
  console.log(`  updatesAvailable=${summary.status.updatesAvailable}`);
  console.log(`  hotUpdates=${summary.hotUpdates}`);
  console.log(`  matureUpdates=${summary.matureUpdates}`);
  console.log(`  securityIssues=${summary.securityIssues}`);
  console.log(`  (sanity: list length ${list.length}, first tagPinned=${list[0].tagPinned})`);
  console.log('');

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
