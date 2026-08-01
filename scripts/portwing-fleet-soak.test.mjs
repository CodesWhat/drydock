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
