import type { DependencyGraph, DependencyGraphNode } from '@/types/container';
import {
  buildDependencyAdjacency,
  collectTransitiveChildIds,
  collectTransitiveParentIds,
  getDependencyComponentIds,
  getDirectChildren,
  getDirectParents,
} from '@/utils/dependency-graph-view';

function makeNode(id: string): DependencyGraphNode {
  return { id, name: id, displayName: id };
}

function makeGraph(overrides: Partial<DependencyGraph> = {}): DependencyGraph {
  return {
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    cycles: overrides.cycles ?? [],
    unresolved: overrides.unresolved ?? [],
    crossHostIgnored: overrides.crossHostIgnored ?? [],
  };
}

describe('buildDependencyAdjacency', () => {
  it('returns empty maps for a null graph', () => {
    const adjacency = buildDependencyAdjacency(null);

    expect(adjacency.parentIdsByChild.size).toBe(0);
    expect(adjacency.childIdsByParent.size).toBe(0);
    expect(adjacency.nodeById.size).toBe(0);
    expect(adjacency.cycleMemberIds.size).toBe(0);
    expect(adjacency.unresolvedTargetsByNodeId.size).toBe(0);
  });

  it('returns empty maps for an undefined graph', () => {
    const adjacency = buildDependencyAdjacency(undefined);

    expect(adjacency.parentIdsByChild.size).toBe(0);
  });

  it('indexes nodes, both edge directions, and cycle members', () => {
    const graph = makeGraph({
      nodes: [makeNode('app'), makeNode('db')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
      cycles: [['app', 'db']],
    });

    const adjacency = buildDependencyAdjacency(graph);

    expect(adjacency.parentIdsByChild.get('app')).toEqual(['db']);
    expect(adjacency.childIdsByParent.get('db')).toEqual(['app']);
    expect(adjacency.nodeById.get('app')).toEqual(makeNode('app'));
    expect(adjacency.cycleMemberIds.has('app')).toBe(true);
    expect(adjacency.cycleMemberIds.has('db')).toBe(true);
  });
});

describe('unresolved targets', () => {
  it('groups unresolved targets by the node that declared them', () => {
    const adjacency = buildDependencyAdjacency(
      makeGraph({
        nodes: [makeNode('app')],
        unresolved: [
          { nodeId: 'app', missingTarget: 'cache' },
          { nodeId: 'app', missingTarget: 'queue' },
        ],
      }),
    );

    expect(adjacency.unresolvedTargetsByNodeId.get('app')).toEqual(['cache', 'queue']);
  });
});

describe('collectTransitiveChildIds', () => {
  const edge = (from: string, to: string) => ({
    from,
    to,
    action: 'update' as const,
    source: 'label' as const,
  });

  it('collects every transitive child, excluding the start id', () => {
    const adjacency = buildDependencyAdjacency(
      makeGraph({ edges: [edge('app', 'db'), edge('web', 'app'), edge('worker', 'db')] }),
    );

    expect(collectTransitiveChildIds(adjacency, 'db')).toEqual(new Set(['app', 'web', 'worker']));
  });

  it('terminates on a cycle without including the start id', () => {
    const adjacency = buildDependencyAdjacency(
      makeGraph({ edges: [edge('a', 'b'), edge('b', 'a')] }),
    );

    expect(collectTransitiveChildIds(adjacency, 'a')).toEqual(new Set(['b']));
  });

  it('returns an empty set for a leaf', () => {
    const adjacency = buildDependencyAdjacency(makeGraph({ edges: [edge('app', 'db')] }));

    expect(collectTransitiveChildIds(adjacency, 'app').size).toBe(0);
  });
});

describe('getDirectParents / getDirectChildren', () => {
  it('resolves direct parents to node objects', () => {
    const graph = makeGraph({
      nodes: [makeNode('app'), makeNode('db')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });
    const adjacency = buildDependencyAdjacency(graph);

    expect(getDirectParents(adjacency, 'app')).toEqual([makeNode('db')]);
    expect(getDirectChildren(adjacency, 'db')).toEqual([makeNode('app')]);
  });

  it('returns an empty array for an id with no edges', () => {
    const adjacency = buildDependencyAdjacency(makeGraph());

    expect(getDirectParents(adjacency, 'missing')).toEqual([]);
    expect(getDirectChildren(adjacency, 'missing')).toEqual([]);
  });

  it('drops ids that are still traversable but have no matching node', () => {
    const graph = makeGraph({
      nodes: [makeNode('app')],
      edges: [{ from: 'app', to: 'ghost', action: 'update', source: 'label' }],
    });
    const adjacency = buildDependencyAdjacency(graph);

    expect(getDirectParents(adjacency, 'app')).toEqual([]);
    expect(getDirectChildren(adjacency, 'ghost')).toEqual([makeNode('app')]);
  });
});

describe('collectTransitiveParentIds', () => {
  it('collects every transitive parent, excluding the start id', () => {
    const graph = makeGraph({
      nodes: [makeNode('app'), makeNode('cache'), makeNode('db')],
      edges: [
        { from: 'app', to: 'cache', action: 'update', source: 'label' },
        { from: 'cache', to: 'db', action: 'update', source: 'label' },
      ],
    });
    const adjacency = buildDependencyAdjacency(graph);

    const parents = collectTransitiveParentIds(adjacency, 'app');

    expect(parents).toEqual(new Set(['cache', 'db']));
  });

  it('terminates on a cycle without including the start id', () => {
    const graph = makeGraph({
      nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
      edges: [
        { from: 'a', to: 'b', action: 'update', source: 'label' },
        { from: 'b', to: 'c', action: 'update', source: 'label' },
        { from: 'c', to: 'a', action: 'update', source: 'label' },
      ],
    });
    const adjacency = buildDependencyAdjacency(graph);

    const parents = collectTransitiveParentIds(adjacency, 'a');

    expect(parents).toEqual(new Set(['b', 'c']));
  });

  it('returns an empty set for a leaf with no parents', () => {
    const adjacency = buildDependencyAdjacency(makeGraph({ nodes: [makeNode('app')] }));

    expect(collectTransitiveParentIds(adjacency, 'app')).toEqual(new Set());
  });

  it('returns an empty set for an unknown id against a null graph', () => {
    expect(collectTransitiveParentIds(buildDependencyAdjacency(null), 'x')).toEqual(new Set());
  });

  it('includes an edge-only parent that has no matching node', () => {
    const graph = makeGraph({
      nodes: [makeNode('app')],
      edges: [{ from: 'app', to: 'ghost', action: 'update', source: 'label' }],
    });
    const adjacency = buildDependencyAdjacency(graph);

    expect(collectTransitiveParentIds(adjacency, 'app')).toEqual(new Set(['ghost']));
  });
});

describe('getDependencyComponentIds', () => {
  it('always includes rootId, even with no edges', () => {
    const adjacency = buildDependencyAdjacency(makeGraph());

    expect(getDependencyComponentIds(adjacency, 'solo')).toEqual(new Set(['solo']));
  });

  it('collects the full undirected component in both directions', () => {
    const graph = makeGraph({
      nodes: [makeNode('app'), makeNode('db'), makeNode('sidecar')],
      edges: [
        { from: 'app', to: 'db', action: 'update', source: 'label' },
        { from: 'sidecar', to: 'app', action: 'restart', source: 'compose' },
      ],
    });
    const adjacency = buildDependencyAdjacency(graph);

    expect(getDependencyComponentIds(adjacency, 'db')).toEqual(new Set(['db', 'app', 'sidecar']));
  });

  it('terminates on a cycle', () => {
    const graph = makeGraph({
      nodes: [makeNode('a'), makeNode('b')],
      edges: [
        { from: 'a', to: 'b', action: 'update', source: 'label' },
        { from: 'b', to: 'a', action: 'update', source: 'label' },
      ],
    });
    const adjacency = buildDependencyAdjacency(graph);

    expect(getDependencyComponentIds(adjacency, 'a')).toEqual(new Set(['a', 'b']));
  });

  it('returns just the root id for an unknown id against a null graph', () => {
    expect(getDependencyComponentIds(buildDependencyAdjacency(null), 'x')).toEqual(new Set(['x']));
  });

  it('includes an edge-only node that has no matching entry in nodes', () => {
    const graph = makeGraph({
      nodes: [makeNode('app')],
      edges: [{ from: 'app', to: 'ghost', action: 'update', source: 'label' }],
    });
    const adjacency = buildDependencyAdjacency(graph);

    expect(getDependencyComponentIds(adjacency, 'app')).toEqual(new Set(['app', 'ghost']));
    expect(getDirectParents(adjacency, 'app')).toEqual([]);
  });
});
