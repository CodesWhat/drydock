#!/usr/bin/env node
// One-off microbench for drydock #301 rc.9 watcher/agents hotspot fix.
// Simulates the four code paths before and after the fix, using synthetic
// fixtures sized to the reporter's Synology LAN topology (3 agents,
// 5 watchers each, 60 containers distributed across them).
//
// Runs as: node scripts/bench-301-watcher-api.mjs
//
// Outputs a table comparing before/after wall-clock for GET /api/watchers,
// GET /api/agents, AgentsView mount, and ServersView mount.

import { setTimeout as sleep } from 'node:timers/promises';

const AGENTS = 3;
const WATCHERS_PER_AGENT = 5;
const CONTAINERS_PER_WATCHER = 4;
const LAN_RTT_MS = 30;
const ITERATIONS = 5;

function buildFixtures() {
  const agents = [];
  const watchers = [];
  const containers = [];
  for (let a = 0; a < AGENTS; a++) {
    const agentName = `agent-${a}`;
    agents.push({ name: agentName, connected: true });
    for (let w = 0; w < WATCHERS_PER_AGENT; w++) {
      const watcherName = `${agentName}-w${w}`;
      watchers.push({
        id: `${agentName}.docker.${watcherName}`,
        type: 'docker',
        name: watcherName,
        agent: agentName,
        configuration: { cron: '*/5 * * * *' },
        metadata: { nextRunAt: '2026-04-19T12:00:00.000Z' },
      });
      for (let c = 0; c < CONTAINERS_PER_WATCHER; c++) {
        containers.push({
          id: `${watcherName}-c${c}`,
          watcher: watcherName,
          agent: agentName,
          status: c % 2 === 0 ? 'running' : 'exited',
          updateAvailable: c === 0,
          image: { id: `img-${a}-${w}`, name: `image-${a}-${w}:1` },
        });
      }
    }
  }
  return { agents, watchers, containers };
}

async function timeRuns(label, fn) {
  const runs = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await fn();
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  const min = runs[0];
  const max = runs[runs.length - 1];
  return { label, median, min, max };
}

// ────────────────────────────────────────────────────────────────────
// Hotspot 1: GET /api/watchers
// ────────────────────────────────────────────────────────────────────

async function benchWatchersBefore(fixtures) {
  // Before: one HTTP RPC per agent-backed watcher, Promise.all'd.
  await Promise.all(
    fixtures.watchers.map(async () => {
      await sleep(LAN_RTT_MS);
    }),
  );
}

async function benchWatchersAfter(fixtures) {
  // After: synchronous cache read per watcher, no network.
  const cache = new Map();
  for (const w of fixtures.watchers) {
    cache.set(`${w.agent}.${w.type}.${w.name}`, w);
  }
  for (const w of fixtures.watchers) {
    cache.get(`${w.agent}.${w.type}.${w.name}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Hotspot 2: GET /api/agents — per-agent stats
// ────────────────────────────────────────────────────────────────────

function benchAgentsStatsBefore({ agents, containers }) {
  // Before: clone full container collection, build per-agent Map, then
  // 3 filter passes per agent + new Set per agent for image fingerprints.
  const cloned = structuredClone(containers);
  const byAgent = new Map();
  for (const c of cloned) {
    if (!byAgent.has(c.agent)) byAgent.set(c.agent, []);
    byAgent.get(c.agent).push(c);
  }
  for (const a of agents) {
    const list = byAgent.get(a.name) ?? [];
    list.filter((c) => c.status === 'running').length;
    list.filter((c) => c.status !== 'running').length;
    list.filter((c) => c.updateAvailable).length;
    new Set(list.map((c) => c.image?.id ?? c.image?.name ?? c.id)).size;
  }
}

function benchAgentsStatsAfter({ agents, containers }) {
  // After: single pass, pre-allocated per-agent buckets.
  const buckets = new Map();
  for (const a of agents) {
    buckets.set(a.name, { total: 0, running: 0, updates: 0, images: new Set() });
  }
  for (const c of containers) {
    const b = buckets.get(c.agent);
    if (!b) continue;
    b.total += 1;
    if (c.status === 'running') b.running += 1;
    if (c.updateAvailable) b.updates += 1;
    const key = c.image?.id ?? c.image?.name ?? c.id;
    if (typeof key === 'string' && key !== '') b.images.add(key);
  }
}

// ────────────────────────────────────────────────────────────────────
// Hotspot 3: AgentsView mount — eager log prefetch
// ────────────────────────────────────────────────────────────────────

async function benchAgentsViewBefore({ agents }) {
  // Before: fetchAgentLogs(agent.name, { tail: 50 }) for every connected
  // agent in parallel on mount.
  await Promise.all(
    agents
      .filter((a) => a.connected)
      .map(async () => {
        await sleep(LAN_RTT_MS);
      }),
  );
}

async function benchAgentsViewAfter() {
  // After: no eager logs fetch; logs load when user opens Logs tab.
}

// ────────────────────────────────────────────────────────────────────
// Hotspot 4: ServersView mount — redundant getAllContainers
// ────────────────────────────────────────────────────────────────────

async function benchServersViewBefore(fixtures) {
  // Before: parallel GET /api/agents + GET /api/watchers + GET /api/containers.
  await Promise.all([
    (async () => {
      await sleep(LAN_RTT_MS);
      benchAgentsStatsBefore(fixtures);
    })(),
    (async () => {
      await sleep(LAN_RTT_MS);
      await benchWatchersBefore(fixtures);
    })(),
    (async () => {
      await sleep(LAN_RTT_MS);
      // Client-side per-watcher grouping over the container array.
      const counts = {};
      const images = {};
      for (const c of fixtures.containers) {
        counts[c.watcher] = (counts[c.watcher] ?? 0) + 1;
        (images[c.watcher] ??= new Set()).add(c.image?.id ?? c.image?.name);
      }
    })(),
  ]);
}

async function benchServersViewAfter(fixtures) {
  // After: GET /api/agents + GET /api/watchers only; counts come from
  // watcher.metadata and agent payload.
  await Promise.all([
    (async () => {
      await sleep(LAN_RTT_MS);
      benchAgentsStatsAfter(fixtures);
    })(),
    (async () => {
      await sleep(LAN_RTT_MS);
      await benchWatchersAfter(fixtures);
    })(),
  ]);
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

function fmtMs(n) {
  return n < 1 ? n.toFixed(3) : n.toFixed(2);
}

function speedup(before, after) {
  if (after === 0) return '∞';
  return `${(before / after).toFixed(1)}×`;
}

async function main() {
  const fixtures = buildFixtures();
  console.log('\n## Drydock #301 watcher/agents hotspot microbench\n');
  console.log(
    `Fixtures: ${AGENTS} agents × ${WATCHERS_PER_AGENT} watchers × ${CONTAINERS_PER_WATCHER} containers = ${fixtures.containers.length} containers`,
  );
  console.log(`Simulated LAN RTT: ${LAN_RTT_MS}ms per HTTP RPC`);
  console.log(`Iterations per scenario: ${ITERATIONS} (reported: median / min / max)\n`);

  const rows = [];
  rows.push([
    'GET /api/watchers (before)',
    await timeRuns('', () => benchWatchersBefore(fixtures)),
  ]);
  rows.push(['GET /api/watchers (after)', await timeRuns('', () => benchWatchersAfter(fixtures))]);
  rows.push([
    'GET /api/agents stats (before)',
    await timeRuns('', () => benchAgentsStatsBefore(fixtures)),
  ]);
  rows.push([
    'GET /api/agents stats (after)',
    await timeRuns('', () => benchAgentsStatsAfter(fixtures)),
  ]);
  rows.push([
    'AgentsView mount logs fetch (before)',
    await timeRuns('', () => benchAgentsViewBefore(fixtures)),
  ]);
  rows.push([
    'AgentsView mount logs fetch (after)',
    await timeRuns('', () => benchAgentsViewAfter()),
  ]);
  rows.push([
    'ServersView mount (before)',
    await timeRuns('', () => benchServersViewBefore(fixtures)),
  ]);
  rows.push([
    'ServersView mount (after)',
    await timeRuns('', () => benchServersViewAfter(fixtures)),
  ]);

  const label = 'Scenario'.padEnd(42);
  console.log(`| ${label} | Median ms | Min ms | Max ms |`);
  console.log(`| ${'-'.repeat(label.length)} | --------- | ------ | ------ |`);
  for (const [name, r] of rows) {
    console.log(
      `| ${name.padEnd(label.length)} | ${fmtMs(r.median).padStart(9)} | ${fmtMs(r.min).padStart(6)} | ${fmtMs(r.max).padStart(6)} |`,
    );
  }

  console.log('\n### Speedups (before / after median)\n');
  const pairs = [
    ['GET /api/watchers', rows[0][1], rows[1][1]],
    ['GET /api/agents stats', rows[2][1], rows[3][1]],
    ['AgentsView mount logs', rows[4][1], rows[5][1]],
    ['ServersView mount', rows[6][1], rows[7][1]],
  ];
  for (const [name, before, after] of pairs) {
    console.log(
      `- ${name}: ${fmtMs(before.median)}ms → ${fmtMs(after.median)}ms (${speedup(before.median, after.median)})`,
    );
  }
  console.log('');
}

await main();
