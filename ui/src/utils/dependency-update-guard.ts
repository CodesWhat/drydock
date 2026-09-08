import { collectTransitiveParentIds, type DependencyAdjacency } from './dependency-graph-view';

export interface StaleParent {
  id: string;
  name: string;
}

/**
 * Finds every transitive parent of `containerId` that already has a pending
 * update and is not itself part of the dispatch (#219, roadmap 6.1) —
 * updating a dependent first would leave it running against an outdated
 * parent, so this backs the child-before-parent warning shown before a
 * single-container update.
 *
 * A parent is included iff it is not in `dispatchIds` AND
 * `hasPendingUpdate(parentId) === true`. `undefined` (the parent is not in
 * the caller's current container list) never warns — there is nothing to
 * report against. Order follows BFS discovery order over the parent chain.
 */
export function findStaleParents(args: {
  adjacency: DependencyAdjacency;
  containerId: string;
  dispatchIds: ReadonlySet<string>;
  hasPendingUpdate: (id: string) => boolean | undefined;
}): StaleParent[] {
  const { adjacency, containerId, dispatchIds, hasPendingUpdate } = args;
  const stale: StaleParent[] = [];

  for (const parentId of collectTransitiveParentIds(adjacency, containerId)) {
    if (dispatchIds.has(parentId)) {
      continue;
    }
    if (hasPendingUpdate(parentId) !== true) {
      continue;
    }
    const node = adjacency.nodeById.get(parentId);
    stale.push({ id: parentId, name: node?.name ?? parentId });
  }

  return stale;
}

/**
 * Joins up to `max` stale-parent names for display, reporting how many were
 * left out so the caller can render "and N more".
 */
export function formatStaleParentNames(
  parents: StaleParent[],
  max = 5,
): { names: string; overflow: number } {
  const shown = parents.slice(0, max);
  const overflow = parents.length - shown.length;
  return { names: shown.map((parent) => parent.name).join(', '), overflow };
}
