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
