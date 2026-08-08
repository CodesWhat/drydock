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

/**
 * Compose-sourced target names are compose SERVICE names, unambiguous only
 * within the same compose project (design §1) — matched via the
 * `com.docker.compose.service` label of candidate containers, scoped to
 * containers sharing the source's own `com.docker.compose.project` label.
 */
function findComposeCandidates(
  containers: DependencyGraphContainer[],
  source: DependencyGraphContainer,
  targetName: string,
): DependencyGraphContainer[] {
  const sourceProject = source.labels?.[COMPOSE_PROJECT_LABEL];
  if (!sourceProject) {
    return [];
  }
  return containers.filter(
    (candidate) =>
      candidate.id !== source.id &&
      candidate.labels?.[COMPOSE_SERVICE_LABEL] === targetName &&
      candidate.labels?.[COMPOSE_PROJECT_LABEL] === sourceProject,
  );
}

/**
 * Label-sourced target names are container names, scoped to the same
 * `watcher` (design §1) — matched via the container `name` field. Agent
 * scoping is intentionally NOT applied at the candidate-matching stage (a
 * same-named container can exist on multiple agents behind one watcher
 * name); it's applied afterward so a same-watcher/different-agent match can
 * be distinguished as `crossHostIgnored` rather than silently unresolved.
 */
function findLabelCandidates(
  containers: DependencyGraphContainer[],
  source: DependencyGraphContainer,
  targetName: string,
): DependencyGraphContainer[] {
  return containers.filter(
    (candidate) =>
      candidate.id !== source.id &&
      candidate.name === targetName &&
      candidate.watcher === source.watcher,
  );
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
          ? findComposeCandidates(containers, container, targetName)
          : findLabelCandidates(containers, container, targetName);

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

/** Tarjan's strongly-connected-components over an adjacency-list subgraph. */
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

  function strongConnect(v: string): void {
    indices.set(v, nextIndex);
    lowlink.set(v, nextIndex);
    nextIndex += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) as number, lowlink.get(w) as number));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) as number, indices.get(w) as number));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  }

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) {
      strongConnect(nodeId);
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
  let remaining = [...nodeIds].filter((id) => !processed.has(id));

  while (remaining.length > 0) {
    const remainingSet = new Set(remaining);
    const adjacency = new Map<string, string[]>();
    for (const edge of validEdges) {
      if (remainingSet.has(edge.from) && remainingSet.has(edge.to)) {
        const list = adjacency.get(edge.from) ?? [];
        list.push(edge.to);
        adjacency.set(edge.from, list);
      }
    }

    const components = stronglyConnectedComponents(remaining, adjacency);
    const componentIdByNode = new Map<string, number>();
    components.forEach((component, componentIndex) => {
      for (const nodeId of component) {
        componentIdByNode.set(nodeId, componentIndex);
      }
    });

    // A component is "ready" this round when none of its members point (via
    // a within-`remaining` edge) at a DIFFERENT still-remaining component —
    // i.e. every dependency it has outside itself has already been
    // scheduled in an earlier wave. Condensing any graph into its SCCs
    // always yields a DAG, so at least one component is ready every round —
    // this loop always makes progress and terminates.
    const readyNodeIds: string[] = [];
    for (const [componentIndex, component] of components.entries()) {
      const isReady = component.every((nodeId) =>
        (adjacency.get(nodeId) ?? []).every(
          (target) => componentIdByNode.get(target) === componentIndex,
        ),
      );
      if (!isReady) {
        continue;
      }
      readyNodeIds.push(...component);
      const isSelfLoop =
        component.length === 1 && (adjacency.get(component[0]) ?? []).includes(component[0]);
      if (component.length > 1 || isSelfLoop) {
        cycles.push([...component].sort(byName));
      }
    }

    waves.push([...readyNodeIds].sort(byName));
    for (const id of readyNodeIds) {
      processed.add(id);
    }
    remaining = remaining.filter((id) => !processed.has(id));
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
