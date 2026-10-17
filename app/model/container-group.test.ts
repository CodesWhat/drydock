import { getContainerGroup, getContainerGroupIdentity } from './container-group.js';

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

describe('getContainerGroupIdentity', () => {
  test.each([
    [undefined, null],
    [{}, null],
    [{ 'dd.group': 'Payments' }, { name: 'Payments', label: 'dd.group' }],
    [
      { 'dd.group': '', 'com.docker.compose.project': 'fallback' },
      { name: '', label: 'dd.group' },
    ],
    [
      { 'dd.group': null, 'com.docker.compose.project': 'compose' } as never,
      { name: 'compose', label: 'com.docker.compose.project' },
    ],
    [
      { 'com.docker.compose.project': 'compose', 'com.docker.stack.namespace': 'swarm' },
      { name: 'compose', label: 'com.docker.compose.project' },
    ],
    [
      { 'com.docker.stack.namespace': 'swarm' },
      { name: 'swarm', label: 'com.docker.stack.namespace' },
    ],
  ])('names the group and the label that supplied it for %j', (labels, expected) => {
    expect(getContainerGroupIdentity({ labels })).toEqual(expected);
  });

  test('getContainerGroup is the name of the identity', () => {
    const labels = { 'dd.group': ' Spaced ', 'com.docker.compose.project': 'compose' };
    expect(getContainerGroup({ labels })).toBe(getContainerGroupIdentity({ labels })?.name);
  });
});
