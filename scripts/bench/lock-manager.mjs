#!/usr/bin/env node

// Validates rc.17's keyed LockManager + Semaphore in updates/lock-primitives.
// Three scenarios with N=10 concurrent acquirers each holding for 50ms:
//
//  1. Unrelated containers — distinct keys → parallel execution (~50ms total)
//  2. Same compose project — same key N times → serialized (~50*N ms total)
//  3. Global semaphore cap — Semaphore(4) with 16 acquirers (~200ms total)
//
// Run as: node scripts/bench/lock-manager.mjs

import { setTimeout as sleep } from 'node:timers/promises';
import { LockManager, Semaphore } from '../../app/dist/updates/lock-primitives.js';

const HOLD_MS = 50;
const N = 10;

function fmtMs(n) {
  return n.toFixed(0);
}

// ────────────────────────────────────────────────────────────────────
// Scenario 1: Unrelated containers — N distinct keys, parallel expected
// ────────────────────────────────────────────────────────────────────

async function scenarioParallel() {
  const lm = new LockManager();
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      lm.withLocks([`container-${i}`], async () => {
        await sleep(HOLD_MS);
      }),
    ),
  );
  const elapsed = performance.now() - t0;
  const expectedMin = HOLD_MS;
  const expectedMax = HOLD_MS * 2; // generous: truly parallel should be ~50ms
  const passed = elapsed >= expectedMin && elapsed < expectedMax;
  return { elapsed, expectedMin, expectedMax, passed };
}

// ────────────────────────────────────────────────────────────────────
// Scenario 2: Same compose project — same key N times, serialized expected
// ────────────────────────────────────────────────────────────────────

async function scenarioSerial() {
  const lm = new LockManager();
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: N }, () =>
      lm.withLocks(['compose-project-foo'], async () => {
        await sleep(HOLD_MS);
      }),
    ),
  );
  const elapsed = performance.now() - t0;
  // Serial: N slots × HOLD_MS. Allow 20% slack each way for event-loop jitter.
  const expectedMin = HOLD_MS * N * 0.8;
  const expectedMax = HOLD_MS * N * 1.4;
  const passed = elapsed >= expectedMin && elapsed < expectedMax;
  return { elapsed, expectedMin, expectedMax, passed };
}

// ────────────────────────────────────────────────────────────────────
// Scenario 3: Semaphore(4) with 16 concurrent acquirers, each holding 50ms
// Expected: 4 batches → ~200ms
// ────────────────────────────────────────────────────────────────────

async function scenarioSemaphore() {
  const sem = new Semaphore(4);
  const ACQUIRERS = 16;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: ACQUIRERS }, async () => {
      const release = await sem.acquire();
      try {
        await sleep(HOLD_MS);
      } finally {
        release();
      }
    }),
  );
  const elapsed = performance.now() - t0;
  // 16 acquirers / 4 permits = 4 batches × 50ms = 200ms.
  const batchCount = Math.ceil(ACQUIRERS / 4);
  const expectedMin = HOLD_MS * batchCount * 0.8;
  const expectedMax = HOLD_MS * batchCount * 1.4;
  const passed = elapsed >= expectedMin && elapsed < expectedMax;
  return { elapsed, expectedMin, expectedMax, passed, batchCount };
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n## Lock-manager concurrency bench — rc.17 LockManager + Semaphore\n');
  console.log(`Hold duration per acquirer: ${HOLD_MS}ms, N=${N} concurrent acquirers.\n`);

  // Scenario 1
  console.log('### Scenario 1: Unrelated containers (N distinct keys)\n');
  console.log(`  Expected: parallel → ~${HOLD_MS}ms total`);
  const s1 = await scenarioParallel();
  console.log(
    `  Observed: ${fmtMs(s1.elapsed)}ms  [expected ${fmtMs(s1.expectedMin)}–${fmtMs(s1.expectedMax)}ms]  ${s1.passed ? 'PASS' : 'FAIL'}`,
  );
  console.log('');

  // Scenario 2
  console.log('### Scenario 2: Same compose project (same key, N=10 times)\n');
  console.log(`  Expected: serialized → ~${HOLD_MS * N}ms total`);
  const s2 = await scenarioSerial();
  console.log(
    `  Observed: ${fmtMs(s2.elapsed)}ms  [expected ${fmtMs(s2.expectedMin)}–${fmtMs(s2.expectedMax)}ms]  ${s2.passed ? 'PASS' : 'FAIL'}`,
  );
  console.log('');

  // Scenario 3
  console.log('### Scenario 3: Global Semaphore(4), 16 concurrent acquirers\n');
  const s3 = await scenarioSemaphore();
  console.log(`  Expected: ${s3.batchCount} batches of 4 → ~${HOLD_MS * s3.batchCount}ms total`);
  console.log(
    `  Observed: ${fmtMs(s3.elapsed)}ms  [expected ${fmtMs(s3.expectedMin)}–${fmtMs(s3.expectedMax)}ms]  ${s3.passed ? 'PASS' : 'FAIL'}`,
  );
  console.log('');

  // Summary
  const allPassed = s1.passed && s2.passed && s3.passed;
  console.log('### Summary\n');
  console.log(`| Scenario                         | Observed ms | Expected range ms | Result |`);
  console.log(`| -------------------------------- | ----------- | ----------------- | ------ |`);
  console.log(
    `| Distinct keys (parallel)         | ${fmtMs(s1.elapsed).padStart(11)} | ${fmtMs(s1.expectedMin)}–${fmtMs(s1.expectedMax).padEnd(13)} | ${s1.passed ? 'PASS  ' : 'FAIL  '} |`,
  );
  console.log(
    `| Same key (serialized)            | ${fmtMs(s2.elapsed).padStart(11)} | ${fmtMs(s2.expectedMin)}–${fmtMs(s2.expectedMax).padEnd(13)} | ${s2.passed ? 'PASS  ' : 'FAIL  '} |`,
  );
  console.log(
    `| Semaphore(4) cap (16 acquirers)  | ${fmtMs(s3.elapsed).padStart(11)} | ${fmtMs(s3.expectedMin)}–${fmtMs(s3.expectedMax).padEnd(13)} | ${s3.passed ? 'PASS  ' : 'FAIL  '} |`,
  );
  console.log('');
  console.log(
    `Serial/parallel speedup: ${(s2.elapsed / s1.elapsed).toFixed(1)}× slower when same key`,
  );
  console.log(
    `Overall: ${allPassed ? 'ALL PASS' : 'SOME FAILURES — check observed vs expected above'}`,
  );
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

await main().catch((e) => {
  console.error(e);
  process.exit(1);
});
