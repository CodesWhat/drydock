#!/usr/bin/env node
// Microbench for the drydock #301 rc.10 slow-dashboard/slow-containers
// fix set. Compares the three backend hotspots that this PR addressed,
// sized for the reporter's topology (88 containers).
//
// Before-scenarios deliberately reconstruct the pre-fix behavior
// (4-pass filter summary, live `tagPinned` getter that recompiles the
// user's regex, spread + structuredClone clone that walks every getter
// twice) against the same fixture as the after-scenario. Each scenario
// is warmed up once and then timed over ITERATIONS runs.
//
// Run as: node scripts/bench-301-rc10-dashboard.mjs

import { performance } from 'node:perf_hooks';
import { isTagPinned } from '../app/dist/tag/precision.js';
import { buildContainerDashboardSummary } from '../app/dist/util/container-summary.js';

const CONTAINERS = 88;
const ITERATIONS = 200;
const CLONE_ITERATIONS = 100;

function maturityLevelForIndex(i) {
  const mod = i % 6;
  if (mod === 0) return 'hot';
  if (mod === 1) return 'mature';
  if (mod === 2) return 'established';
  return 'unknown';
}

// Build containers roughly shaped like the post-validate model. The
// "before" scenarios install the enumerable getter so that cloning the
// object walks the getter for every enumerable read; the "after"
// scenarios use plain data properties.
function buildContainersWithGetter(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = {
      id: `c-${i}`,
      name: `container-${i}`,
      status: i % 4 === 0 ? 'exited' : 'running',
      updateAvailable: i % 3 === 0,
      updateMaturityLevel: maturityLevelForIndex(i),
      security: {
        scan: {
          summary: {
            critical: i % 7 === 0 ? 1 : 0,
            high: i % 5 === 0 ? 2 : 0,
          },
        },
      },
      image: { tag: { value: `1.${i}.0-arm64` } },
      // Intentionally non-trivial transform so safeRegExp has work to do.
      transformTags: '^([0-9]+)\\.([0-9]+)\\.([0-9]+)(?:-(.+))?$ => $1.$2.$3',
    };
    Object.defineProperty(c, 'tagPinned', {
      enumerable: true,
      configurable: true,
      get() {
        return isTagPinned(this.image.tag.value, this.transformTags);
      },
    });
    out.push(c);
  }
  return out;
}

function buildContainersMaterialized(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const tag = `1.${i}.0-arm64`;
    const transformTags = '^([0-9]+)\\.([0-9]+)\\.([0-9]+)(?:-(.+))?$ => $1.$2.$3';
    out.push({
      id: `c-${i}`,
      name: `container-${i}`,
      status: i % 4 === 0 ? 'exited' : 'running',
      updateAvailable: i % 3 === 0,
      updateMaturityLevel: maturityLevelForIndex(i),
      security: {
        scan: {
          summary: {
            critical: i % 7 === 0 ? 1 : 0,
            high: i % 5 === 0 ? 2 : 0,
          },
        },
      },
      image: { tag: { value: tag } },
      transformTags,
      tagPinned: isTagPinned(tag, transformTags),
    });
  }
  return out;
}

// Old summary handler: four independent filter passes over the list.
function summaryBefore(containers) {
  const total = containers.length;
  const running = containers.filter((c) => String(c.status ?? '').toLowerCase() === 'running')
    .length;
  const updatesAvailable = containers.filter((c) => c.updateAvailable === true).length;
  const hotUpdates = containers.filter(
    (c) => c.updateAvailable === true && c.updateMaturityLevel === 'hot',
  ).length;
  const matureUpdates = containers.filter(
    (c) =>
      c.updateAvailable === true &&
      (c.updateMaturityLevel === 'mature' || c.updateMaturityLevel === 'established'),
  ).length;
  const securityIssues = containers.filter((c) => {
    const s = c.security?.scan?.summary;
    return Number(s?.critical ?? 0) > 0 || Number(s?.high ?? 0) > 0;
  }).length;
  return {
    status: { total, running, stopped: Math.max(total - running, 0), updatesAvailable },
    securityIssues,
    hotUpdates,
    matureUpdates,
  };
}

// Old clone path (pre-fix cloneContainer): shallow-spread the container
// with resultChanged stripped, structuredClone the result, then pin
// resultChanged back onto the clone. The spread walks every enumerable
// getter — including the live tagPinned — so the regex compile runs
// per-container per-clone.
function cloneBefore(c) {
  const resultChanged = c.resultChanged;
  const withoutResultChanged = { ...c, resultChanged: undefined };
  const cloned = structuredClone(withoutResultChanged);
  cloned.resultChanged = resultChanged;
  return cloned;
}

// New clone path: structuredClone only. tagPinned is a plain property,
// resultChanged is non-enumerable so structuredClone skips it. We then
// reattach it on the clone with the same non-enumerable descriptor.
function cloneAfter(c) {
  const cloned = structuredClone(c);
  Object.defineProperty(cloned, 'resultChanged', {
    value: c.resultChanged,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return cloned;
}

// Attach a non-enumerable resultChanged so the clone path sees the
// same shape the post-fix model installs.
function attachResultChanged(containers) {
  for (const c of containers) {
    Object.defineProperty(c, 'resultChanged', {
      value: () => false,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
}

// Attach an enumerable (plain-assigned) resultChanged to mimic the
// pre-fix model, which set it as a normal writable property. The spread
// in cloneBefore will copy it; we then overwrite it with undefined in
// the spread object, so structuredClone never sees the function.
function attachEnumerableResultChanged(containers) {
  for (const c of containers) {
    c.resultChanged = () => false;
  }
}

function timeRuns(label, fn, iterations = ITERATIONS) {
  fn();
  const runs = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return {
    label,
    median: runs[Math.floor(runs.length / 2)],
    min: runs[0],
    max: runs[runs.length - 1],
    p95: runs[Math.floor(runs.length * 0.95)],
  };
}

function fmtMs(n) {
  if (n < 1) return n.toFixed(3);
  if (n < 10) return n.toFixed(2);
  return n.toFixed(1);
}

function speedup(before, after) {
  if (after <= 0) return '∞';
  return `${(before / after).toFixed(1)}×`;
}

function main() {
  console.log('\n## Drydock #301 rc.10 slow-dashboard/containers microbench\n');
  console.log(
    `Fixtures: ${CONTAINERS} containers (reporter topology), ${ITERATIONS} iterations per scenario.\n`,
  );

  const before = buildContainersWithGetter(CONTAINERS);
  const after = buildContainersMaterialized(CONTAINERS);
  attachEnumerableResultChanged(before);
  attachResultChanged(after);

  const rows = [];

  rows.push([
    'Dashboard summary (4-pass filter, before)',
    timeRuns('summaryBefore', () => summaryBefore(before)),
  ]);
  rows.push([
    'Dashboard summary (single pass, after)',
    timeRuns('summaryAfter', () => buildContainerDashboardSummary(after)),
  ]);

  rows.push([
    'Container clone (spread + structuredClone, before)',
    timeRuns('cloneBefore', () => {
      for (const c of before) cloneBefore(c);
    }, CLONE_ITERATIONS),
  ]);
  rows.push([
    'Container clone (structuredClone only, after)',
    timeRuns('cloneAfter', () => {
      for (const c of after) cloneAfter(c);
    }, CLONE_ITERATIONS),
  ]);

  // Pure "read tagPinned once per container" cost — the getter hot path
  // versus a plain property access.
  rows.push([
    'Read tagPinned on all containers (getter, before)',
    timeRuns('readGetter', () => {
      let sink = 0;
      for (const c of before) if (c.tagPinned) sink += 1;
      if (sink < 0) console.log(sink);
    }),
  ]);
  rows.push([
    'Read tagPinned on all containers (data prop, after)',
    timeRuns('readProp', () => {
      let sink = 0;
      for (const c of after) if (c.tagPinned) sink += 1;
      if (sink < 0) console.log(sink);
    }),
  ]);

  const label = 'Scenario'.padEnd(54);
  console.log(`| ${label} | Median ms | p95 ms | Min ms | Max ms |`);
  console.log(
    `| ${'-'.repeat(label.length)} | --------- | ------ | ------ | ------ |`,
  );
  for (const [name, r] of rows) {
    console.log(
      `| ${name.padEnd(label.length)} | ${fmtMs(r.median).padStart(9)} | ${fmtMs(r.p95).padStart(6)} | ${fmtMs(r.min).padStart(6)} | ${fmtMs(r.max).padStart(6)} |`,
    );
  }

  console.log('\n### Speedups (before / after median)\n');
  const pairs = [
    ['Dashboard summary', rows[0][1], rows[1][1]],
    ['Container clone (88 containers)', rows[2][1], rows[3][1]],
    ['tagPinned read fan-out', rows[4][1], rows[5][1]],
  ];
  for (const [name, b, a] of pairs) {
    console.log(
      `- ${name}: ${fmtMs(b.median)}ms → ${fmtMs(a.median)}ms (${speedup(b.median, a.median)})`,
    );
  }
  console.log('');
}

main();
