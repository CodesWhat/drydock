import { type DependencyAdjacency, getDependencyComponentIds } from './dependency-graph-view';

interface DependencyTreeEntry {
  id: string;
  /** 0 for a root (nothing it depends on is in the list), +1 per level of dependents. */
  depth: number;
}

interface DependencyTreeComponent {
  /** Containers with no visible dependency, in list order. The first one anchors group actions. */
  rootIds: string[];
  /** Pre-order walk: every parent is listed before its dependents. */
  entries: DependencyTreeEntry[];
}

export interface DependencyTrees {
  components: DependencyTreeComponent[];
  /** Containers with no visible dependency edges at all. */
  ungroupedIds: string[];
}

/**
 * Splits the visible containers into dependency trees (#219). Each weakly
 * connected component of two or more visible containers becomes one tree,
 * walked parent-first so a dependent always renders under what it needs.
 * `orderedIds` is the list's display order and decides root and sibling order.
 *
 * A container with several parents renders once, under the first parent that
 * reaches it. Members of a cycle have no root of their own, so any member the
 * root walk did not reach starts its own walk, in list order.
 */
export function buildDependencyTrees(
  adjacency: DependencyAdjacency,
  orderedIds: string[],
): DependencyTrees {
  const present = new Set(orderedIds);
  const assigned = new Set<string>();
  const components: DependencyTreeComponent[] = [];
  const ungroupedIds: string[] = [];

  for (const startId of orderedIds) {
    if (assigned.has(startId)) {
      continue;
    }
    const componentIds = getDependencyComponentIds(adjacency, startId);
    const members = orderedIds.filter((id) => componentIds.has(id));
    for (const id of members) {
      assigned.add(id);
    }
    if (members.length < 2) {
      ungroupedIds.push(startId);
      continue;
    }

    const visited = new Set<string>();
    const entries: DependencyTreeEntry[] = [];
    const walk = (id: string, depth: number) => {
      visited.add(id);
      entries.push({ id, depth });
      const children = (adjacency.childIdsByParent.get(id) ?? [])
        .filter((childId) => present.has(childId) && !visited.has(childId))
        .sort((left, right) => orderedIds.indexOf(left) - orderedIds.indexOf(right));
      for (const childId of children) {
        if (!visited.has(childId)) {
          walk(childId, depth + 1);
        }
      }
    };

    const rootIds = members.filter((id) =>
      (adjacency.parentIdsByChild.get(id) ?? []).every((parentId) => !present.has(parentId)),
    );
    for (const rootId of rootIds) {
      walk(rootId, 0);
    }
    for (const id of members) {
      if (!visited.has(id)) {
        walk(id, 0);
      }
    }
    components.push({ rootIds: rootIds.length > 0 ? rootIds : [entries[0].id], entries });
  }

  return { components, ungroupedIds };
}
