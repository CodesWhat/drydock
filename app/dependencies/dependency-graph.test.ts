import {
  buildDependencyGraph,
  computeDependencyGraph,
  type DependencyEdge,
  type DependencyNode,
  topologicalSort,
} from './dependency-graph.js';

function makeContainer(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    watcher: 'local',
    ...overrides,
  };
}

describe('buildDependencyGraph', () => {
  test('returns empty nodes/edges for an empty container list', () => {
    expect(buildDependencyGraph([])).toEqual({
      nodes: [],
      edges: [],
      unresolved: [],
      crossHostIgnored: [],
    });
  });

  test('includes every container as a node, even with no dependsOn', () => {
    const containers = [makeContainer({ name: 'a' }), makeContainer({ name: 'b' })];
    const result = buildDependencyGraph(containers);
    expect(result.nodes).toEqual([
      { id: 'a', name: 'a', agent: undefined },
      { id: 'b', name: 'b', agent: undefined },
    ]);
    expect(result.edges).toEqual([]);
  });

  test('resolves a label-sourced dependency by container name within the same watcher', () => {
    const containers = [
      makeContainer({ name: 'web', dependsOn: ['db'], dependsOnSource: 'label' }),
      makeContainer({ name: 'db' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([{ from: 'web', to: 'db', action: 'update', source: 'label' }]);
    expect(result.unresolved).toEqual([]);
  });

  test('defaults action to "update" and source to "label" when unset', () => {
    const containers = [
      makeContainer({ name: 'web', dependsOn: ['db'] }),
      makeContainer({ name: 'db' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([{ from: 'web', to: 'db', action: 'update', source: 'label' }]);
  });

  test('honors a non-default dependsOnAction', () => {
    const containers = [
      makeContainer({ name: 'web', dependsOn: ['db'], dependsOnAction: 'restart' }),
      makeContainer({ name: 'db' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges[0].action).toBe('restart');
  });

  test('resolves a compose-sourced dependency by service name within the same compose project', () => {
    const containers = [
      makeContainer({
        name: 'web-1',
        dependsOn: ['db'],
        dependsOnSource: 'compose',
        labels: { 'com.docker.compose.project': 'stack', 'com.docker.compose.service': 'web' },
      }),
      makeContainer({
        name: 'db-1',
        labels: { 'com.docker.compose.project': 'stack', 'com.docker.compose.service': 'db' },
      }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([
      { from: 'web-1', to: 'db-1', action: 'update', source: 'compose' },
    ]);
  });

  test('does not resolve a compose-sourced dependency against a same-named service in a different project', () => {
    const containers = [
      makeContainer({
        name: 'web-1',
        dependsOn: ['db'],
        dependsOnSource: 'compose',
        labels: { 'com.docker.compose.project': 'stack-a', 'com.docker.compose.service': 'web' },
      }),
      makeContainer({
        name: 'db-1',
        labels: { 'com.docker.compose.project': 'stack-b', 'com.docker.compose.service': 'db' },
      }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([{ nodeId: 'web-1', missingTarget: 'db' }]);
  });

  test('reports an unresolved target when compose source has no project label of its own', () => {
    const containers = [
      makeContainer({ name: 'web-1', dependsOn: ['db'], dependsOnSource: 'compose' }),
      makeContainer({
        name: 'db-1',
        labels: { 'com.docker.compose.project': 'stack', 'com.docker.compose.service': 'db' },
      }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([{ nodeId: 'web-1', missingTarget: 'db' }]);
  });

  test('reports an unresolved target when no container matches the name', () => {
    const containers = [makeContainer({ name: 'web', dependsOn: ['ghost'] })];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([{ nodeId: 'web', missingTarget: 'ghost' }]);
  });

  test('reports an unresolved target when a same-named container exists only on a different watcher', () => {
    const containers = [
      makeContainer({ name: 'web', watcher: 'local', dependsOn: ['db'] }),
      makeContainer({ name: 'db', watcher: 'remote' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([{ nodeId: 'web', missingTarget: 'db' }]);
  });

  test('reports crossHostIgnored when the only matching target is on a different agent, and drops the edge', () => {
    const containers = [
      makeContainer({ name: 'web', agent: 'agent-a', dependsOn: ['db'] }),
      makeContainer({ id: 'db-b', name: 'db', agent: 'agent-b' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.crossHostIgnored).toEqual([{ from: 'web', to: 'db-b' }]);
  });

  test('prefers a same-agent match over a same-named container on a different agent', () => {
    const containers = [
      makeContainer({ name: 'web', agent: 'agent-a', dependsOn: ['db'] }),
      makeContainer({ id: 'db-b', name: 'db', agent: 'agent-b' }),
      makeContainer({ id: 'db-a', name: 'db', agent: 'agent-a' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([{ from: 'web', to: 'db-a', action: 'update', source: 'label' }]);
    expect(result.crossHostIgnored).toEqual([]);
  });

  test('treats a container with no agent and a container with an explicit agent as different scopes', () => {
    const containers = [
      makeContainer({ name: 'web', dependsOn: ['db'] }),
      makeContainer({ id: 'db-agent', name: 'db', agent: 'agent-a' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.crossHostIgnored).toEqual([{ from: 'web', to: 'db-agent' }]);
  });

  test('gracefully degrades to unresolved for a self-referencing dependsOn entry that slipped through detection', () => {
    // Detection (container-init.ts / compose-dependency-resolver.ts) already
    // drops self-references before dependsOn reaches this module ("self-edge
    // already filtered" precondition) — this exercises the graph engine's
    // own robustness if one ever did slip through: a container can never
    // match itself as a candidate, so it degrades to unresolved rather than
    // producing a self-loop edge or crashing.
    const containers = [makeContainer({ name: 'web', dependsOn: ['web'] })];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([{ nodeId: 'web', missingTarget: 'web' }]);
  });

  test('resolves multiple dependsOn entries for one container independently', () => {
    const containers = [
      makeContainer({ name: 'web', dependsOn: ['db', 'cache', 'ghost'] }),
      makeContainer({ name: 'db' }),
      makeContainer({ name: 'cache' }),
    ];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([
      { from: 'web', to: 'db', action: 'update', source: 'label' },
      { from: 'web', to: 'cache', action: 'update', source: 'label' },
    ]);
    expect(result.unresolved).toEqual([{ nodeId: 'web', missingTarget: 'ghost' }]);
  });

  test('an empty dependsOn array produces no edges (label override to zero dependencies)', () => {
    const containers = [makeContainer({ name: 'web', dependsOn: [], dependsOnSource: 'label' })];
    const result = buildDependencyGraph(containers);
    expect(result.edges).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});

function edge(from: string, to: string): DependencyEdge {
  return { from, to, action: 'update', source: 'label' };
}

function node(id: string, name = id, agent?: string): DependencyNode {
  return { id, name, agent };
}

describe('topologicalSort', () => {
  test('empty graph produces no waves and no cycles', () => {
    expect(topologicalSort([], [])).toEqual({ waves: [], cycles: [] });
  });

  test('a single node with no edges is its own wave', () => {
    expect(topologicalSort([node('a')], [])).toEqual({ waves: [['a']], cycles: [] });
  });

  test('disconnected nodes with no edges land together in one wave, sorted alphabetically', () => {
    const nodes = [node('charlie'), node('alpha'), node('bravo')];
    expect(topologicalSort(nodes, [])).toEqual({
      waves: [['alpha', 'bravo', 'charlie']],
      cycles: [],
    });
  });

  test('a linear chain resolves one node per wave in dependency order', () => {
    // c depends on b depends on a
    const nodes = [node('c'), node('b'), node('a')];
    const edges = [edge('b', 'a'), edge('c', 'b')];
    expect(topologicalSort(nodes, edges)).toEqual({
      waves: [['a'], ['b'], ['c']],
      cycles: [],
    });
  });

  test('a diamond groups independent parallel dependents into the same wave', () => {
    // b and c both depend on a; d depends on both b and c
    const nodes = [node('d'), node('c'), node('b'), node('a')];
    const edges = [edge('b', 'a'), edge('c', 'a'), edge('d', 'b'), edge('d', 'c')];
    expect(topologicalSort(nodes, edges)).toEqual({
      waves: [['a'], ['b', 'c'], ['d']],
      cycles: [],
    });
  });

  test('ties within a wave are broken alphabetically by name, not input order', () => {
    const nodes = [node('c-node', 'charlie'), node('a-node', 'alpha'), node('b-node', 'bravo')];
    const result = topologicalSort(nodes, []);
    expect(result.waves).toEqual([['a-node', 'b-node', 'c-node']]);
  });

  test('ties fall back to id ordering when two nodes share the same name', () => {
    const nodes = [node('z-id', 'same'), node('a-id', 'same')];
    const result = topologicalSort(nodes, []);
    expect(result.waves).toEqual([['a-id', 'z-id']]);
  });

  test('a 2-node cycle is scheduled as one unordered wave and reported as a cycle', () => {
    const nodes = [node('b'), node('a')];
    const edges = [edge('a', 'b'), edge('b', 'a')];
    expect(topologicalSort(nodes, edges)).toEqual({
      waves: [['a', 'b']],
      cycles: [['a', 'b']],
    });
  });

  test('a 3-node cycle is scheduled as one unordered wave and reported as a cycle', () => {
    const nodes = [node('c'), node('b'), node('a')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    const result = topologicalSort(nodes, edges);
    expect(result.waves).toEqual([['a', 'b', 'c']]);
    expect(result.cycles).toEqual([['a', 'b', 'c']]);
  });

  test('cycle-adjacent-to-valid-subgraph: a non-cycle dependent is still correctly ordered after the cycle', () => {
    // a <-> b is a cycle; c depends on a (outside the cycle).
    const nodes = [node('c'), node('b'), node('a')];
    const edges = [edge('a', 'b'), edge('b', 'a'), edge('c', 'a')];
    const result = topologicalSort(nodes, edges);
    expect(result.waves).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(result.cycles).toEqual([['a', 'b']]);
  });

  test('a cross edge into an already-closed SCC (visited earlier in traversal order) is ignored correctly', () => {
    // a<->b is a cycle discovered and closed first (in that traversal
    // order); d is discovered afterward and points into the now-closed
    // component rather than being part of it or a back-edge within it.
    const nodes = [node('a'), node('b'), node('d')];
    const edges = [edge('a', 'b'), edge('b', 'a'), edge('d', 'a')];
    const result = topologicalSort(nodes, edges);
    expect(result.waves).toEqual([
      ['a', 'b'],
      ['d'],
    ]);
    expect(result.cycles).toEqual([['a', 'b']]);
  });

  test('a clean prefix wave still resolves before an unrelated cycle', () => {
    // x has no deps; a <-> b is an unrelated cycle.
    const nodes = [node('b'), node('a'), node('x')];
    const edges = [edge('a', 'b'), edge('b', 'a')];
    const result = topologicalSort(nodes, edges);
    expect(result.waves).toEqual([['x'], ['a', 'b']]);
    expect(result.cycles).toEqual([['a', 'b']]);
  });

  test('two independent cycles in the same round are merged into a single wave', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('b', 'a'), edge('c', 'd'), edge('d', 'c')];
    const result = topologicalSort(nodes, edges);
    expect(result.waves).toEqual([['a', 'b', 'c', 'd']]);
    expect(result.cycles).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('a duplicate edge between the same pair does not break wave assignment', () => {
    const nodes = [node('b'), node('a')];
    const edges = [edge('b', 'a'), edge('b', 'a')];
    expect(topologicalSort(nodes, edges)).toEqual({ waves: [['a'], ['b']], cycles: [] });
  });

  test('ignores an edge referencing a node id that is not in the node list', () => {
    const nodes = [node('a')];
    const edges = [edge('a', 'ghost')];
    expect(topologicalSort(nodes, edges)).toEqual({ waves: [['a']], cycles: [] });
  });

  test('wave output is identical across shuffled input orderings (determinism)', () => {
    const baseNodes = [node('d'), node('c'), node('b'), node('a')];
    const baseEdges = [edge('b', 'a'), edge('c', 'a'), edge('d', 'b'), edge('d', 'c')];
    const expected = topologicalSort(baseNodes, baseEdges);

    const permutations = [
      [[...baseNodes].reverse(), [...baseEdges].reverse()],
      [
        [baseNodes[2], baseNodes[0], baseNodes[3], baseNodes[1]],
        [baseEdges[3], baseEdges[1], baseEdges[0], baseEdges[2]],
      ],
      [
        [baseNodes[1], baseNodes[3], baseNodes[0], baseNodes[2]],
        [baseEdges[2], baseEdges[0], baseEdges[3], baseEdges[1]],
      ],
    ] as const;

    for (const [shuffledNodes, shuffledEdges] of permutations) {
      expect(topologicalSort([...shuffledNodes], [...shuffledEdges])).toEqual(expected);
    }
  });
});

describe('computeDependencyGraph', () => {
  test('composes buildDependencyGraph + topologicalSort into the full result shape', () => {
    const containers = [
      makeContainer({ name: 'web', dependsOn: ['db', 'ghost'] }),
      makeContainer({ name: 'db' }),
    ];
    const result = computeDependencyGraph(containers);
    expect(result).toEqual({
      waves: [['db'], ['web']],
      cycles: [],
      unresolved: [{ nodeId: 'web', missingTarget: 'ghost' }],
      crossHostIgnored: [],
    });
  });

  test('an empty container list produces an empty result', () => {
    expect(computeDependencyGraph([])).toEqual({
      waves: [],
      cycles: [],
      unresolved: [],
      crossHostIgnored: [],
    });
  });
});
