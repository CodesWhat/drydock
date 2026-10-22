import type { DependencyGraph } from '@/types/container';

const mockGetContainerDependencies = vi.fn();

vi.mock('@/services/container', () => ({
  getContainerDependencies: (...args: unknown[]) => mockGetContainerDependencies(...args),
}));

function makeGraph(): DependencyGraph {
  return {
    nodes: [
      { id: 'app', name: 'app', displayName: 'app' },
      { id: 'db', name: 'db', displayName: 'db' },
    ],
    edges: [{ from: 'app', to: 'db', action: 'update', source: 'label' }],
    cycles: [],
    unresolved: [],
    crossHostIgnored: [],
  };
}

describe('useDependencyGraph', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function loadComposable() {
    return await import('@/composables/useDependencyGraph');
  }

  it('starts with a null graph and no error', async () => {
    const { useDependencyGraph } = await loadComposable();
    const { graph, error } = useDependencyGraph();

    expect(graph.value).toBeNull();
    expect(error.value).toBeNull();
  });

  it('loads the graph and derives adjacency from it', async () => {
    mockGetContainerDependencies.mockResolvedValueOnce(makeGraph());

    const { useDependencyGraph } = await loadComposable();
    const { graph, adjacency, loadDependencyGraph } = useDependencyGraph();
    await loadDependencyGraph();

    expect(graph.value).toEqual(makeGraph());
    expect(adjacency.value.parentIdsByChild.get('app')).toEqual(['db']);
  });

  it('sets error to the failure message and leaves graph as-is on a rejected load', async () => {
    mockGetContainerDependencies.mockResolvedValueOnce(makeGraph());

    const { useDependencyGraph } = await loadComposable();
    const { graph, error, loadDependencyGraph } = useDependencyGraph();
    await loadDependencyGraph();

    mockGetContainerDependencies.mockRejectedValueOnce(new Error('dependencies unavailable'));
    await loadDependencyGraph();

    expect(error.value).toBe('dependencies unavailable');
    expect(graph.value).toEqual(makeGraph());
  });

  it('falls back to the default error message for a non-Error rejection', async () => {
    mockGetContainerDependencies.mockRejectedValueOnce('boom');

    const { useDependencyGraph } = await loadComposable();
    const { error, loadDependencyGraph } = useDependencyGraph();
    await loadDependencyGraph();

    expect(error.value).toBe('boom');
  });

  it('clears a prior error on a successful reload', async () => {
    mockGetContainerDependencies.mockRejectedValueOnce(new Error('down'));

    const { useDependencyGraph } = await loadComposable();
    const { error, loadDependencyGraph } = useDependencyGraph();
    await loadDependencyGraph();
    expect(error.value).toBe('down');

    mockGetContainerDependencies.mockResolvedValueOnce(makeGraph());
    await loadDependencyGraph();

    expect(error.value).toBeNull();
  });

  it('shares state across every composable call (module-level singleton)', async () => {
    mockGetContainerDependencies.mockResolvedValueOnce(makeGraph());

    const { useDependencyGraph } = await loadComposable();
    const first = useDependencyGraph();
    const second = useDependencyGraph();
    await first.loadDependencyGraph();

    expect(second.graph.value).toEqual(makeGraph());
  });

  describe('expandedIds / toggleExpanded / isExpanded', () => {
    it('toggling an id on replaces the Set and marks it expanded', async () => {
      const { useDependencyGraph } = await loadComposable();
      const { expandedIds, toggleExpanded, isExpanded } = useDependencyGraph();

      const before = expandedIds.value;
      toggleExpanded('app');

      expect(expandedIds.value).not.toBe(before);
      expect(isExpanded('app')).toBe(true);
    });

    it('toggling an already-expanded id collapses it', async () => {
      const { useDependencyGraph } = await loadComposable();
      const { toggleExpanded, isExpanded } = useDependencyGraph();

      toggleExpanded('app');
      toggleExpanded('app');

      expect(isExpanded('app')).toBe(false);
    });

    it('isExpanded returns false for an id never toggled', async () => {
      const { useDependencyGraph } = await loadComposable();
      const { isExpanded } = useDependencyGraph();

      expect(isExpanded('never-toggled')).toBe(false);
    });
  });

  describe('resetDependencyGraphState', () => {
    it('resets graph, error, and expandedIds back to their initial values', async () => {
      mockGetContainerDependencies.mockResolvedValueOnce(makeGraph());

      const { useDependencyGraph, resetDependencyGraphState } = await loadComposable();
      const { graph, error, expandedIds, toggleExpanded, loadDependencyGraph } =
        useDependencyGraph();
      await loadDependencyGraph();
      toggleExpanded('app');

      resetDependencyGraphState();

      expect(graph.value).toBeNull();
      expect(error.value).toBeNull();
      expect(expandedIds.value.size).toBe(0);
    });
  });
});
