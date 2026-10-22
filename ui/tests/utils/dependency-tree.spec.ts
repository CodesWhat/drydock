import type { DependencyGraph } from '@/types/container';
import { buildDependencyAdjacency } from '@/utils/dependency-graph-view';
import { buildDependencyTrees } from '@/utils/dependency-tree';

function adjacencyOf(edges: Array<[string, string]>) {
  const ids = new Set(edges.flat());
  const graph: DependencyGraph = {
    nodes: [...ids].map((id) => ({ id, name: id, displayName: id })),
    edges: edges.map(([from, to]) => ({ from, to, action: 'update', source: 'label' })),
    cycles: [],
    unresolved: [],
    crossHostIgnored: [],
  };
  return buildDependencyAdjacency(graph);
}

describe('buildDependencyTrees', () => {
  it('returns nothing grouped for an empty list', () => {
    expect(buildDependencyTrees(adjacencyOf([]), [])).toEqual({
      components: [],
      ungroupedIds: [],
    });
  });

  it('keeps containers without edges ungrouped, in list order', () => {
    const trees = buildDependencyTrees(adjacencyOf([['app', 'db']]), ['x', 'app', 'db', 'y']);

    expect(trees.ungroupedIds).toEqual(['x', 'y']);
    expect(trees.components).toHaveLength(1);
  });

  it('walks parents before dependents with increasing depth', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['app', 'db'],
        ['web', 'app'],
      ]),
      ['web', 'app', 'db'],
    );

    expect(trees.components).toEqual([
      {
        rootIds: ['db'],
        entries: [
          { id: 'db', depth: 0 },
          { id: 'app', depth: 1 },
          { id: 'web', depth: 2 },
        ],
      },
    ]);
  });

  it('orders roots and siblings by list order', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['b', 'root'],
        ['a', 'root'],
        ['c', 'other'],
        ['c', 'root'],
      ]),
      ['root', 'a', 'b', 'other', 'c'],
    );

    expect(trees.components).toHaveLength(1);
    expect(trees.components[0].rootIds).toEqual(['root', 'other']);
    expect(trees.components[0].entries.map((entry) => entry.id)).toEqual([
      'root',
      'a',
      'b',
      'c',
      'other',
    ]);
  });

  it('renders a container with two parents once, under the first', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['app', 'db'],
        ['app', 'cache'],
      ]),
      ['db', 'cache', 'app'],
    );

    const ids = trees.components[0].entries.map((entry) => entry.id);
    expect(ids.filter((id) => id === 'app')).toHaveLength(1);
    expect(ids).toEqual(['db', 'app', 'cache']);
  });

  it('starts a walk from a cycle member nothing else reaches', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['a', 'b'],
        ['b', 'a'],
      ]),
      ['a', 'b'],
    );

    expect(trees.components).toEqual([
      {
        rootIds: ['a'],
        entries: [
          { id: 'a', depth: 0 },
          { id: 'b', depth: 1 },
        ],
      },
    ]);
  });

  it('treats a dependent as a root when its parent is filtered out of the list', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['app', 'db'],
        ['web', 'app'],
      ]),
      ['web', 'app'],
    );

    expect(trees.components[0].rootIds).toEqual(['app']);
    expect(trees.components[0].entries).toEqual([
      { id: 'app', depth: 0 },
      { id: 'web', depth: 1 },
    ]);
  });

  it('leaves a lone visible member of a bigger component ungrouped', () => {
    const trees = buildDependencyTrees(adjacencyOf([['app', 'db']]), ['app']);

    expect(trees).toEqual({ components: [], ungroupedIds: ['app'] });
  });

  it('survives a self-dependency and a diamond', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['a', 'a'],
        ['b', 'a'],
        ['c', 'a'],
        ['d', 'b'],
        ['d', 'c'],
      ]),
      ['a', 'b', 'c', 'd'],
    );

    expect(trees.components[0].entries.map((entry) => entry.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('does not repeat a sibling that an earlier sibling already reached', () => {
    const trees = buildDependencyTrees(
      adjacencyOf([
        ['b', 'a'],
        ['c', 'a'],
        ['c', 'b'],
      ]),
      ['a', 'b', 'c'],
    );

    expect(trees.components[0].entries).toEqual([
      { id: 'a', depth: 0 },
      { id: 'b', depth: 1 },
      { id: 'c', depth: 2 },
    ]);
  });
});
