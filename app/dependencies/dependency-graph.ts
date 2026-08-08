import type { Container } from '../model/container.js';

/**
 * Pure dependency graph engine (#219, Phase 6.1, v1.7 PR2).
 *
 * No I/O, no store access — everything here is a pure function over plain
 * data, fully unit-testable in isolation and reusable by any future
 * execution-integration call site (request-update.ts's wave-partitioned
 * dispatcher, Dockercompose.ts's runtime-update ordering) without coupling
 * this module to either.
 *
 * Two composable primitives, per the design:
 * - `buildDependencyGraph(containers)` resolves each container's raw
 *   `dependsOn` name list (set by container-init.ts /
 *   compose-dependency-resolver.ts) against the other containers in the
 *   same list — this is the "edge-resolution time" validation point named in
 *   the design, since target containers may not have existed yet when
 *   `dependsOn` was first parsed off labels/compose.
 * - `topologicalSort(nodes, edges)` runs Kahn's algorithm to produce
 *   deterministic topological "waves" (arrays of ids safe to dispatch in
 *   parallel), falling back to an unordered-but-still-scheduled group for
 *   any cycle so a bad dependency graph can never deadlock the dispatcher.
 *
 * `computeDependencyGraph(containers)` composes both into the full
 * `DependencyGraphResult` shape for callers that just want the end result.
 */

export interface DependencyNode {
  id: string;
  name: string;
  agent?: string;
}

export interface DependencyEdge {
  /** The dependent container's node id (the one carrying `dependsOn`). */
  from: string;
  /** The dependency's node id (must be dispatched first). */
  to: string;
  action: 'update' | 'restart';
  source: 'label' | 'compose';
}

export interface UnresolvedDependencyEdge {
  nodeId: string;
  missingTarget: string;
}

export interface CrossHostIgnoredEdge {
  from: string;
  to: string;
}

export interface DependencyGraphResult {
  /** Topological levels; index 0 has no unresolved deps, dispatched first. */
  waves: string[][];
  /** Groups of node ids involved in a cycle (unordered among themselves). */
  cycles: string[][];
  unresolved: UnresolvedDependencyEdge[];
  crossHostIgnored: CrossHostIgnoredEdge[];
}

export interface BuildDependencyGraphResult {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  unresolved: UnresolvedDependencyEdge[];
  crossHostIgnored: CrossHostIgnoredEdge[];
}

type DependencyGraphContainer = Pick<
  Container,
  | 'id'
  | 'name'
  | 'watcher'
  | 'agent'
  | 'labels'
  | 'dependsOn'
  | 'dependsOnSource'
  | 'dependsOnAction'
>;

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

function normalizeAgent(agent: string | undefined): string {
  return agent ?? '';
}

/** Outer key -> inner key -> every container matching both. */
type ContainerIndex = Map<string, Map<string, DependencyGraphContainer[]>>;

function indexBy(
  containers: DependencyGraphContainer[],
  outerKeyOf: (container: DependencyGraphContainer) => string | undefined,
  innerKeyOf: (container: DependencyGraphContainer) => string | undefined,
): ContainerIndex {
  const index: ContainerIndex = new Map();
  for (const container of containers) {
    const outerKey = outerKeyOf(container);
    const innerKey = innerKeyOf(container);
    if (outerKey === undefined || innerKey === undefined) {
      continue;
    }
    let byInnerKey = index.get(outerKey);
    if (!byInnerKey) {
      byInnerKey = new Map();
      index.set(outerKey, byInnerKey);
    }
    const list = byInnerKey.get(innerKey) ?? [];
    list.push(container);
    byInnerKey.set(innerKey, list);
  }
  return index;
}

/**
 * Compose-sourced target names are compose SERVICE names, unambiguous only
 * within the same compose project (design §1) — matched via the
 * `com.docker.compose.service` label of candidate containers, scoped to
 * containers sharing the source's own `com.docker.compose.project` label.
 *
 * `index` is `buildDependencyGraph`'s once-per-call compose-project/service
 * index (see `indexBy`) rather than the full container list, so this is an
 * O(1) map lookup instead of a full scan per `dependsOn` entry.
 */
function findComposeCandidates(
  index: ContainerIndex,
  source: DependencyGraphContainer,
  targetName: string,
): DependencyGraphContainer[] {
  const sourceProject = source.labels?.[COMPOSE_PROJECT_LABEL];
  if (!sourceProject) {
    return [];
  }
  const candidates = index.get(sourceProject)?.get(targetName) ?? [];
  return candidates.filter((candidate) => candidate.id !== source.id);
}

/**
 * Label-sourced target names are container names, scoped to the same
 * `watcher` (design §1) — matched via the container `name` field. Agent
 * scoping is intentionally NOT applied at the candidate-matching stage (a
 * same-named container can exist on multiple agents behind one watcher
 * name); it's applied afterward so a same-watcher/different-agent match can
 * be distinguished as `crossHostIgnored` rather than silently unresolved.
 *
 * `index` is `buildDependencyGraph`'s once-per-call watcher/name index (see
 * `indexBy`) rather than the full container list, so this is an O(1) map
 * lookup instead of a full scan per `dependsOn` entry.
 */
function findLabelCandidates(
  index: ContainerIndex,
  source: DependencyGraphContainer,
  targetName: string,
): DependencyGraphContainer[] {
  const candidates = index.get(source.watcher)?.get(targetName) ?? [];
  return candidates.filter((candidate) => candidate.id !== source.id);
}

/**
 * Build graph nodes/edges from a container list, resolving each container's
 * raw `dependsOn` name list against the OTHER containers in the same list.
 *
 * - A target name matching no other container is reported in `unresolved`
 *   and the edge is dropped (never a hard error).
 * - A target name matching a container ONLY on a different agent is
 *   reported in `crossHostIgnored` and the edge is dropped — cross-host
 *   dependency chains are an explicit v1.7 non-goal (design §7).
 *
 * Pure — no I/O, no store access.
 */
export function buildDependencyGraph(
  containers: DependencyGraphContainer[],
): BuildDependencyGraphResult {
  const nodes: DependencyNode[] = containers.map((container) => ({
    id: container.id,
    name: container.name,
    agent: container.agent,
  }));

  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedDependencyEdge[] = [];
  const crossHostIgnored: CrossHostIgnoredEdge[] = [];

  // Built once per call rather than re-scanning `containers` for every
  // `dependsOn` entry of every container.
  const labelCandidateIndex = indexBy(
    containers,
    (container) => container.watcher,
    (container) => container.name,
  );
  const composeCandidateIndex = indexBy(
    containers,
    (container) => container.labels?.[COMPOSE_PROJECT_LABEL],
    (container) => container.labels?.[COMPOSE_SERVICE_LABEL],
  );

  for (const container of containers) {
    const dependsOn = container.dependsOn;
    if (!dependsOn || dependsOn.length === 0) {
      continue;
    }

    const action = container.dependsOnAction ?? 'update';
    const source = container.dependsOnSource ?? 'label';

    for (const targetName of dependsOn) {
      const candidates =
        source === 'compose'
          ? findComposeCandidates(composeCandidateIndex, container, targetName)
          : findLabelCandidates(labelCandidateIndex, container, targetName);

      if (candidates.length === 0) {
        unresolved.push({ nodeId: container.id, missingTarget: targetName });
        continue;
      }

      const orderedCandidates = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
      const sameAgentCandidate = orderedCandidates.find(
        (candidate) => normalizeAgent(candidate.agent) === normalizeAgent(container.agent),
      );

      if (!sameAgentCandidate) {
        crossHostIgnored.push({ from: container.id, to: orderedCandidates[0].id });
        continue;
      }

      edges.push({ from: container.id, to: sameAgentCandidate.id, action, source });
    }
  }

  return { nodes, edges, unresolved, crossHostIgnored };
}

/**
 * A single explicit-stack frame standing in for one level of `strongConnect`
 * recursion: `neighbors` is that node's adjacency list and `neighborIndex`
 * is how far through it this frame has iterated so far.
 */
interface TarjanFrame {
  nodeId: string;
  neighbors: string[];
  neighborIndex: number;
}

/**
 * Tarjan's strongly-connected-components over an adjacency-list subgraph.
 *
 * Iterative (explicit work-stack) rather than recursive: a recursive
 * `strongConnect` blows the call stack on a single long dependency chain or
 * cycle around ~5-10k nodes (JS engines cap recursion depth well under
 * that), and a fleet's `dependsOn` graph has no such size bound. Each work
 * frame mirrors one `strongConnect(v)` call — pushed when a fresh node is
 * first visited, popped (and its lowlink propagated to its caller frame)
 * once every one of its neighbors has been examined — so the traversal
 * order, and therefore the resulting SCC partition and component order,
 * are identical to the recursive version for the same input.
 *
 * Precondition: `adjacency` must have an entry (possibly `[]`) for every id
 * in `nodeIds` — the sole caller pre-seeds it that way, so neighbor lookups
 * below are asserted rather than defaulted.
 */
function stronglyConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  for (const rootNodeId of nodeIds) {
    if (indices.has(rootNodeId)) {
      continue;
    }

    const workStack: TarjanFrame[] = [
      { nodeId: rootNodeId, neighbors: adjacency.get(rootNodeId) as string[], neighborIndex: 0 },
    ];
    indices.set(rootNodeId, nextIndex);
    lowlink.set(rootNodeId, nextIndex);
    nextIndex += 1;
    stack.push(rootNodeId);
    onStack.add(rootNodeId);

    while (workStack.length > 0) {
      const frame = workStack[workStack.length - 1];

      if (frame.neighborIndex < frame.neighbors.length) {
        const w = frame.neighbors[frame.neighborIndex];
        frame.neighborIndex += 1;

        if (!indices.has(w)) {
          indices.set(w, nextIndex);
          lowlink.set(w, nextIndex);
          nextIndex += 1;
          stack.push(w);
          onStack.add(w);
          workStack.push({ nodeId: w, neighbors: adjacency.get(w) as string[], neighborIndex: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(
            frame.nodeId,
            Math.min(lowlink.get(frame.nodeId) as number, indices.get(w) as number),
          );
        }
        continue;
      }

      // Every neighbor of frame.nodeId has been examined — equivalent to
      // `strongConnect(frame.nodeId)` returning.
      workStack.pop();
      if (workStack.length > 0) {
        const parent = workStack[workStack.length - 1];
        lowlink.set(
          parent.nodeId,
          Math.min(lowlink.get(parent.nodeId) as number, lowlink.get(frame.nodeId) as number),
        );
      }

      if (lowlink.get(frame.nodeId) === indices.get(frame.nodeId)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop() as string;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.nodeId);
        components.push(component);
      }
    }
  }

  return components;
}

function compareByName(nameById: Map<string, string>) {
  // Only ever called with ids drawn from nameById's own key set (nodeIds),
  // so both lookups are always defined.
  return (a: string, b: string) => {
    const nameCompare = (nameById.get(a) as string).localeCompare(nameById.get(b) as string);
    return nameCompare !== 0 ? nameCompare : a.localeCompare(b);
  };
}

/**
 * Kahn's algorithm (BFS by in-degree, not DFS) so each processed level maps
 * directly onto the existing worker-pool concurrency model as one
 * parallel-dispatchable wave, instead of forcing full serialization.
 *
 * Any node(s) left over once the clean Kahn's pass empties its queue are, by
 * definition, part of a cycle or transitively blocked by one. Those are
 * resolved via strongly-connected-component decomposition: each true cycle
 * (SCC of size > 1) is appended as one unordered wave (satisfying "never
 * deadlock, fall back to unordered for cycle members"), while non-cycle
 * nodes downstream of a cycle still land in their own later, correctly
 * ordered wave once the cycle they depend on has been scheduled.
 *
 * Determinism: every wave is sorted alphabetically by node name (tie-broken
 * by id), never left in Map/array insertion order.
 *
 * Pure — no I/O, no store access.
 */
export function topologicalSort(
  nodes: DependencyNode[],
  edges: DependencyEdge[],
): Pick<DependencyGraphResult, 'waves' | 'cycles'> {
  const nameById = new Map(nodes.map((node) => [node.id, node.name]));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const byName = compareByName(nameById);

  // Defensive: ignore any edge referencing a node id not present in `nodes`.
  // buildDependencyGraph never produces one, but topologicalSort is exported
  // standalone and may be called directly with hand-built input.
  const validEdges = edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  // Pre-seeded to 0 for every node id, below — validEdges is filtered to
  // ids present in `nodes`, so every inDegree/dependents lookup for an
  // edge.from/edge.to in the rest of this function always hits an existing
  // entry.
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // to -> [from, ...] ("to" unblocks these on completion)
  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0);
  }
  for (const edge of validEdges) {
    inDegree.set(edge.from, (inDegree.get(edge.from) as number) + 1);
    const list = dependents.get(edge.to) ?? [];
    list.push(edge.from);
    dependents.set(edge.to, list);
  }

  const waves: string[][] = [];
  const processed = new Set<string>();
  let queue = [...nodeIds].filter((id) => inDegree.get(id) === 0).sort(byName);

  while (queue.length > 0) {
    waves.push(queue);
    for (const id of queue) {
      processed.add(id);
    }
    // A dependent can never already be in `processed` here: reaching that
    // state would require its own indegree to have hit 0 (queuing it) before
    // the edge to `id` — one of the dependencies counted in that indegree —
    // was decremented, which this same per-round "mark all, then decrement
    // all" structure never allows, duplicate edges included (a duplicate
    // only adds more required decrements from the same `id`, resolved
    // together in this same round).
    const next = new Set<string>();
    for (const id of queue) {
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = (inDegree.get(dependent) as number) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) {
          next.add(dependent);
        }
      }
    }
    queue = [...next].sort(byName);
  }

  const cycles: string[][] = [];
  const remaining = [...nodeIds].filter((id) => !processed.has(id));

  if (remaining.length > 0) {
    // Built once, over the full remaining set — not rebuilt/shrunk per
    // round. Pre-seeded to `[]` for every remaining id (mirroring the
    // inDegree pre-seeding above) so stronglyConnectedComponents' neighbor
    // lookups are always defined: a node only ever ends up in `remaining`
    // because it has at least one dependency edge to another remaining node
    // (otherwise the clean Kahn's pass above would already have resolved
    // it), so this map, once built, never needs an empty-fallback default.
    const remainingSet = new Set(remaining);
    const adjacency = new Map<string, string[]>();
    for (const id of remaining) {
      adjacency.set(id, []);
    }
    for (const edge of validEdges) {
      if (remainingSet.has(edge.from) && remainingSet.has(edge.to)) {
        (adjacency.get(edge.from) as string[]).push(edge.to);
      }
    }

    const components = stronglyConnectedComponents(remaining, adjacency);
    const componentIdByNode = new Map<string, number>();
    components.forEach((component, componentIndex) => {
      for (const nodeId of component) {
        componentIdByNode.set(nodeId, componentIndex);
      }
    });

    // Tarjan closes a component only once every node it can reach has
    // itself closed, so `components` already comes out in a valid
    // topological order of the SCC condensation: whenever component A has
    // an edge to a different component B, B appears — and therefore has its
    // `componentLayer` already computed — at a lower index than A. That
    // lets each component's wave ("layer") number be computed in a single
    // forward pass instead of repeatedly recomputing readiness by rebuilding
    // the subgraph every round: a component's layer is one past the highest
    // layer among the (distinct) other components it depends on, or 0 if it
    // depends on none. Bucketing by layer as they're computed — rather than
    // processing components in layer order directly — preserves both the
    // cross-layer wave order and, within a layer, the same relative
    // ordering a fresh per-round computation would have produced.
    const componentLayer: number[] = new Array(components.length).fill(0);
    const layerBuckets: { nodeIds: string[]; cycleEntries: string[][] }[] = [];

    components.forEach((component, componentIndex) => {
      let maxDependencyLayer = -1;
      let isSelfLoop = false;
      for (const nodeId of component) {
        for (const target of adjacency.get(nodeId) as string[]) {
          const targetComponentIndex = componentIdByNode.get(target) as number;
          if (targetComponentIndex === componentIndex) {
            if (target === nodeId) {
              isSelfLoop = true;
            }
            continue;
          }
          maxDependencyLayer = Math.max(maxDependencyLayer, componentLayer[targetComponentIndex]);
        }
      }

      const layer = maxDependencyLayer + 1;
      componentLayer[componentIndex] = layer;

      const bucket = (layerBuckets[layer] ??= { nodeIds: [], cycleEntries: [] });
      bucket.nodeIds.push(...component);
      if (component.length > 1 || isSelfLoop) {
        bucket.cycleEntries.push([...component].sort(byName));
      }
    });

    for (const bucket of layerBuckets) {
      waves.push([...bucket.nodeIds].sort(byName));
      cycles.push(...bucket.cycleEntries);
    }
  }

  return { waves, cycles };
}

/**
 * Compose `buildDependencyGraph` + `topologicalSort` into the full
 * `DependencyGraphResult` shape for callers that just want the end result
 * (the future wave-partitioned dispatcher, API preview endpoint, etc.).
 */
export function computeDependencyGraph(
  containers: DependencyGraphContainer[],
): DependencyGraphResult {
  const { nodes, edges, unresolved, crossHostIgnored } = buildDependencyGraph(containers);
  const { waves, cycles } = topologicalSort(nodes, edges);
  return { waves, cycles, unresolved, crossHostIgnored };
}

/**
 * Reverse adjacency (dependency id -> dependent ids), built once per dispatch
 * and reused across every `collectTransitiveDependents` lookup within it
 * (execution integration, v1.7 Phase 6.1, #219 — design §3): a wave-dispatch
 * failure, or a maintenance-window deferral, needs to find every downstream
 * container that (transitively) depends on the blocked one.
 */
export function buildDependentsByDependency(edges: DependencyEdge[]): Map<string, string[]> {
  const dependentsByDependency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = dependentsByDependency.get(edge.to) ?? [];
    list.push(edge.from);
    dependentsByDependency.set(edge.to, list);
  }
  return dependentsByDependency;
}

/**
 * BFS over a `buildDependentsByDependency` map to find every transitive
 * dependent of `nodeId` — used to skip a whole downstream chain when its
 * root dependency fails or is deferred, rather than only its immediate
 * dependents.
 */
export function collectTransitiveDependents(
  nodeId: string,
  dependentsByDependency: Map<string, string[]>,
): Set<string> {
  const dependents = new Set<string>();
  const queue = [...(dependentsByDependency.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (dependents.has(current)) {
      continue;
    }
    dependents.add(current);
    queue.push(...(dependentsByDependency.get(current) ?? []));
  }
  return dependents;
}

/**
 * BFS over an UNDIRECTED view of `edges` to find every node id in the same
 * weakly-connected component as `rootId` (v1.7 Phase 6.2, #219 — design §4):
 * both the update-chain-preview endpoint and the dependency-group bulk
 * update endpoint need "everything reachable from this root, dependencies
 * and dependents alike" as a single subgraph to hand to
 * `buildDependencyGraph`/`topologicalSort` — the exact same pure functions
 * the real dispatcher uses, so a preview can never drift from what actually
 * runs. `rootId` is always included, even with no edges at all (a trivial
 * single-node component).
 */
export function getConnectedComponentIds(rootId: string, edges: DependencyEdge[]): Set<string> {
  const undirected = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const list = undirected.get(a) ?? [];
    list.push(b);
    undirected.set(a, list);
  };
  for (const edge of edges) {
    addEdge(edge.from, edge.to);
    addEdge(edge.to, edge.from);
  }

  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const neighbor of undirected.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}
