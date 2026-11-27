import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFleetAgents } from './lib/cleanup-fleet-agents.mjs';

test('deregisters agent components before closing and removing fleet agents', async () => {
  const calls = [];
  const agents = [
    {
      name: 'fleet-agent-0',
      edgeAdapter: {
        ws: {
          close: () => calls.push('close:fleet-agent-0'),
        },
      },
    },
  ];

  await cleanupFleetAgents({
    agents,
    deregisterAgentComponents: async (name) => {
      calls.push(`deregister:start:${name}`);
      await Promise.resolve();
      calls.push(`deregister:end:${name}`);
    },
    removeAgent: (name) => calls.push(`remove:${name}`),
  });

  assert.deepEqual(calls, [
    'deregister:start:fleet-agent-0',
    'deregister:end:fleet-agent-0',
    'close:fleet-agent-0',
    'remove:fleet-agent-0',
  ]);
});

test('continues closing agents after one component cleanup fails', async () => {
  const removed = [];
  const errors = [];
  const agents = [{ name: 'fleet-agent-0' }, { name: 'fleet-agent-1' }];

  await cleanupFleetAgents({
    agents,
    deregisterAgentComponents: async (name) => {
      if (name === 'fleet-agent-0') {
        throw new Error('cleanup failed');
      }
    },
    removeAgent: (name) => removed.push(name),
    onError: (name, error) => errors.push(`${name}:${error.message}`),
  });

  assert.deepEqual(removed, ['fleet-agent-0', 'fleet-agent-1']);
  assert.deepEqual(errors, ['fleet-agent-0:cleanup failed']);
});

test('spawned agents opt into the plaintext loopback controller URL', async () => {
  // portwing v0.9.9 (PR CodesWhat/portwing#201) fails closed on http:// or
  // ws:// controller URLs in edge mode unless ALLOW_INSECURE_EDGE_URL=true.
  // The soak dials http://127.0.0.1 by design, so dropping this opt-in makes
  // every spawned agent exit at config load and the soak time out at 0/8
  // registered. Guard the env wiring at the source level.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./portwing-fleet-soak.mjs', import.meta.url), 'utf8');
  assert.match(source, /ALLOW_INSECURE_EDGE_URL: 'true'/);
  const envBlock = source.slice(source.indexOf('DRYDOCK_URL:'));
  assert.ok(
    envBlock.indexOf("ALLOW_INSECURE_EDGE_URL: 'true'") > -1,
    'ALLOW_INSECURE_EDGE_URL must be set alongside the plaintext DRYDOCK_URL',
  );
});

test('slow-consumer phases use backpressure and observed eviction budgets', async () => {
  // Portwing v1.4.0 (#503): short pauses backpressure, only a stall past
  // writeWait (10 s) evicts. Observe the actual write-timeout reconnect.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./portwing-fleet-soak.mjs', import.meta.url), 'utf8');
  assert.match(source, /BACKPRESSURE_PAUSE_MS = 3500/);
  assert.doesNotMatch(source, /EVICTION_PAUSE_MS/);
  assert.match(source, /await observeSlowConsumerReconnect\(/);
  assert.match(source, /hasWriteTimeout:/);
  assert.match(source, /EVICTION_RECONNECT_WAIT_MS = 45_000/);
  assert.match(source, /backpressurePauses: 0/);
  assert.match(source, /backpressureResumed: 0/);
  assert.match(source, /'short pause backpressured without reconnect'/);
});

test('slow consumer pauses through the websocket, not the raw socket', async () => {
  // ws 8.x receiverOnDrain resumes the raw socket unless ws.pause() set
  // isPaused, so a raw _socket.pause() gets undone under heavy inbound traffic
  // and the agent never hits its write timeout.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./portwing-fleet-soak.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /_socket/);
  assert.match(source, /slowAdapter\?\.ws\?\.pause/);
  assert.match(source, /slowAdapter\?\.ws\?\.resume/);
  assert.match(source, /pause: \(\) => slowAdapter\.ws\.pause\(\)/);
  assert.match(source, /resume: \(\) => slowAdapter\.ws\.resume\(\)/);
});
