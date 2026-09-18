import { getContainerGroup } from './container-group.js';

test.each([
  [undefined, null],
  [{}, null],
  [{ 'dd.group': 'Payments' }, 'Payments'],
  [{ 'dd.group': '', 'com.docker.compose.project': 'fallback' }, ''],
  [{ 'dd.group': 'manual', 'com.docker.compose.project': 'compose' }, 'manual'],
  [{ 'com.docker.compose.project': 'compose', 'com.docker.stack.namespace': 'swarm' }, 'compose'],
  [{ 'com.docker.stack.namespace': 'swarm' }, 'swarm'],
])('resolves the exact server group from %j', (labels, expected) => {
  expect(getContainerGroup({ labels })).toBe(expected);
});
