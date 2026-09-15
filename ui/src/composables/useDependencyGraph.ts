import { computed, ref } from 'vue';
import { getContainerDependencies } from '../services/container';
import type { DependencyGraph } from '../types/container';
import { buildDependencyAdjacency, type DependencyAdjacency } from '../utils/dependency-graph-view';
import { errorMessage } from '../utils/error';

// Module-level singleton state shared by every composable consumer (#219,
// roadmap 6.1) — the dependency graph is a single global resource, not
// per-container, so every view that needs it shares one load.
const graph = ref<DependencyGraph | null>(null);
const error = ref<string | null>(null);
const expandedIds = ref<Set<string>>(new Set());

async function loadDependencyGraph(): Promise<void> {
  try {
    graph.value = await getContainerDependencies();
    error.value = null;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedIds.value = next;
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id);
}

export function useDependencyGraph() {
  const adjacency = computed<DependencyAdjacency>(() => buildDependencyAdjacency(graph.value));

  return {
    graph,
    adjacency,
    loadDependencyGraph,
    error,
    expandedIds,
    toggleExpanded,
    isExpanded,
  };
}

/** Test-only reset of the module-level singleton state. */
export function resetDependencyGraphState(): void {
  graph.value = null;
  error.value = null;
  expandedIds.value = new Set();
}
