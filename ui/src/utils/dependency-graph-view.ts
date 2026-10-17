import type { DependencyGraph, DependencyGraphNode } from '../types/container';

/**
 * Adjacency indexes over a `DependencyGraph` (#219, roadmap 6.1), built once
 * per graph load so every view can look up parents/children/cycle membership
 * without re-scanning the edge list.
 *
 * Edge direction mirrors the API and `app/dependencies/dependency-graph.ts`:
 * `edge.from` is the dependent (child, carries `dependsOn`), `edge.to` is the
 * dependency (parent, dispatched first).
 */
export interface DependencyAdjacency {
  /** edge.from -> edge.to[] (a child's direct parents). */
  parentIdsByChild: Map<string, string[]>;
  /** edge.to -> edge.from[] (a parent's direct children). */
  childIdsByParent: Map<string, string[]>;
  nodeById: Map<string, DependencyGraphNode>;
  cycleMemberIds: Set<string>;
}

/** A null/undefined graph (not yet loaded) yields empty, safely-traversable maps. */
export function buildDependencyAdjacency(
  graph: DependencyGraph | null | undefined,
): DependencyAdjacency {
  const parentIdsByChild = new Map<string, string[]>();
  const childIdsByParent = new Map<string, string[]>();
  const nodeById = new Map<string, DependencyGraphNode>();
  const cycleMemberIds = new Set<string>();

  if (!graph) {
    return { parentIdsByChild, childIdsByParent, nodeById, cycleMemberIds };
  }

  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }

  for (const edge of graph.edges) {
    const parents = parentIdsByChild.get(edge.from) ?? [];
    parents.push(edge.to);
    parentIdsByChild.set(edge.from, parents);

    const children = childIdsByParent.get(edge.to) ?? [];
    children.push(edge.from);
    childIdsByParent.set(edge.to, children);
  }

  for (const cycle of graph.cycles) {
    for (const id of cycle) {
      cycleMemberIds.add(id);
    }
  }

  return { parentIdsByChild, childIdsByParent, nodeById, cycleMemberIds };
}

function resolveNodes(
  adjacency: DependencyAdjacency,
  ids: string[] | undefined,
): DependencyGraphNode[] {
  const nodes: DependencyGraphNode[] = [];
  for (const id of ids ?? []) {
    const node = adjacency.nodeById.get(id);
    if (node) {
      nodes.push(node);
    }
  }
  return nodes;
}

/** Direct parents (dependencies) of `id`. Ids with no matching node are dropped. */
export function getDirectParents(
  adjacency: DependencyAdjacency,
  id: string,
): DependencyGraphNode[] {
  return resolveNodes(adjacency, adjacency.parentIdsByChild.get(id));
}

/** Direct children (dependents) of `id`. Ids with no matching node are dropped. */
export function getDirectChildren(
  adjacency: DependencyAdjacency,
  id: string,
): DependencyGraphNode[] {
  return resolveNodes(adjacency, adjacency.childIdsByParent.get(id));
}

/**
 * BFS over `parentIdsByChild` collecting every transitive parent of `id`,
 * cycle-safe via a visited set. `id` itself is never included, even if it
 * sits on a cycle that loops back to it.
 */
export function collectTransitiveParentIds(
  adjacency: DependencyAdjacency,
  id: string,
): Set<string> {
  const parents = new Set<string>();
  const queue = [...(adjacency.parentIdsByChild.get(id) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === id || parents.has(current)) {
      continue;
    }
    parents.add(current);
    queue.push(...(adjacency.parentIdsByChild.get(current) ?? []));
  }
  return parents;
}

/**
 * BFS over an UNDIRECTED view of both adjacency directions to find every
 * node id in the same weakly-connected component as `rootId`. `rootId` is
 * always included, even with no edges at all.
 */
export function getDependencyComponentIds(
  adjacency: DependencyAdjacency,
  rootId: string,
): Set<string> {
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const neighbors = [
      ...(adjacency.parentIdsByChild.get(current) ?? []),
      ...(adjacency.childIdsByParent.get(current) ?? []),
    ];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}
