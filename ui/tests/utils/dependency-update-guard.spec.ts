import type { DependencyGraph, DependencyGraphNode } from '@/types/container';
import { buildDependencyAdjacency } from '@/utils/dependency-graph-view';
import {
  findStaleParents,
  formatStaleParentNames,
  type StaleParent,
} from '@/utils/dependency-update-guard';

function makeNode(id: string, name = id): DependencyGraphNode {
  return { id, name, displayName: name };
}

function makeAdjacency(overrides: Partial<DependencyGraph> = {}) {
  return buildDependencyAdjacency({
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    cycles: overrides.cycles ?? [],
    unresolved: overrides.unresolved ?? [],
    crossHostIgnored: overrides.crossHostIgnored ?? [],
  });
}

describe('findStaleParents', () => {
  it('includes a transitive parent with a pending update that is not in the dispatch set', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app'), makeNode('db', 'database')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });

    const stale = findStaleParents({
      adjacency,
      containerId: 'app',
      dispatchIds: new Set(),
      hasPendingUpdate: (id) => id === 'db',
    });

    expect(stale).toEqual<StaleParent[]>([{ id: 'db', name: 'database' }]);
  });

  it('excludes a parent that is part of the dispatch set', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app'), makeNode('db')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });

    const stale = findStaleParents({
      adjacency,
      containerId: 'app',
      dispatchIds: new Set(['db']),
      hasPendingUpdate: () => true,
    });

    expect(stale).toEqual([]);
  });

  it('excludes a parent with no pending update', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app'), makeNode('db')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });

    const stale = findStaleParents({
      adjacency,
      containerId: 'app',
      dispatchIds: new Set(),
      hasPendingUpdate: () => false,
    });

    expect(stale).toEqual([]);
  });

  it('never warns when hasPendingUpdate returns undefined (parent not in the current list)', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app'), makeNode('db')],
      edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    });

    const stale = findStaleParents({
      adjacency,
      containerId: 'app',
      dispatchIds: new Set(),
      hasPendingUpdate: () => undefined,
    });

    expect(stale).toEqual([]);
  });

  it('falls back to the id when the parent node is missing', () => {
    const adjacency = makeAdjacency({
      nodes: [makeNode('app')],
      edges: [{ from: 'app', to: 'ghost', action: 'update', source: 'label' }],
    });

    const stale = findStaleParents({
      adjacency,
      containerId: 'app',
      dispatchIds: new Set(),
      hasPendingUpdate: () => true,
    });

    expect(stale).toEqual([{ id: 'ghost', name: 'ghost' }]);
  });

  it('returns an empty array when the container has no parents', () => {
    const adjacency = makeAdjacency({ nodes: [makeNode('app')] });

    const stale = findStaleParents({
      adjacency,
      containerId: 'app',
      dispatchIds: new Set(),
      hasPendingUpdate: () => true,
    });

    expect(stale).toEqual([]);
  });
});

describe('formatStaleParentNames', () => {
  it('joins names with ", " and reports zero overflow when under the max', () => {
    const parents: StaleParent[] = [
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'beta' },
    ];

    expect(formatStaleParentNames(parents)).toEqual({ names: 'alpha, beta', overflow: 0 });
  });

  it('caps at the default max of 5 and reports the overflow count', () => {
    const parents: StaleParent[] = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `parent-${i}`,
    }));

    const result = formatStaleParentNames(parents);

    expect(result.names).toBe('parent-0, parent-1, parent-2, parent-3, parent-4');
    expect(result.overflow).toBe(2);
  });

  it('honors a custom max', () => {
    const parents: StaleParent[] = [
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'beta' },
      { id: 'c', name: 'gamma' },
    ];

    expect(formatStaleParentNames(parents, 2)).toEqual({ names: 'alpha, beta', overflow: 1 });
  });

  it('returns an empty string and zero overflow for an empty list', () => {
    expect(formatStaleParentNames([])).toEqual({ names: '', overflow: 0 });
  });
});
