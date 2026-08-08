const mockGetAgents = vi.fn();

vi.mock('@/services/agent', () => ({
  getAgents: (...args: unknown[]) => mockGetAgents(...args),
}));

describe('useAgentHosts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function loadComposable() {
    return await import('@/composables/useAgentHosts');
  }

  it('loads agents and builds a name → host map', async () => {
    mockGetAgents.mockResolvedValueOnce([
      { name: 'agent-1', connected: true, host: 'agent-1.local' },
      { name: 'agent-2', connected: false, host: 'agent-2.local' },
    ]);

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    await agentHosts.loadAgentHosts();

    expect(agentHosts.hostsByAgent.value).toEqual({
      'agent-1': 'agent-1.local',
      'agent-2': 'agent-2.local',
    });
    expect(agentHosts.loaded.value).toBe(true);
  });

  it('skips agents with a missing or empty name', async () => {
    mockGetAgents.mockResolvedValueOnce([
      { name: '', connected: true, host: 'nameless.local' },
      { connected: true, host: 'unnamed.local' },
      { name: '   ', connected: true, host: 'blank.local' },
      { name: 'agent-ok', connected: true, host: 'agent-ok.local' },
    ]);

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    await agentHosts.loadAgentHosts();

    expect(agentHosts.hostsByAgent.value).toEqual({ 'agent-ok': 'agent-ok.local' });
  });

  it('skips agents with a missing or empty host', async () => {
    mockGetAgents.mockResolvedValueOnce([
      { name: 'agent-1', connected: true, host: '' },
      { name: 'agent-2', connected: true },
      { name: 'agent-3', connected: true, host: '   ' },
      { name: 'agent-ok', connected: true, host: 'agent-ok.local' },
    ]);

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    await agentHosts.loadAgentHosts();

    expect(agentHosts.hostsByAgent.value).toEqual({ 'agent-ok': 'agent-ok.local' });
  });

  it('fails closed to {} when the fetch rejects', async () => {
    mockGetAgents.mockRejectedValueOnce(new Error('agents unavailable'));

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    await agentHosts.loadAgentHosts();

    expect(agentHosts.hostsByAgent.value).toEqual({});
    expect(agentHosts.loaded.value).toBe(false);
  });

  it('resolveHost returns the mapped host for a known agent', async () => {
    mockGetAgents.mockResolvedValueOnce([{ name: 'agent-1', connected: true, host: '10.0.0.5' }]);

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    await agentHosts.loadAgentHosts();

    expect(agentHosts.resolveHost('agent-1', 'fallback.test')).toBe('10.0.0.5');
  });

  it('resolveHost returns the fallback for an unknown agent name', async () => {
    mockGetAgents.mockResolvedValueOnce([{ name: 'agent-1', connected: true, host: '10.0.0.5' }]);

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    await agentHosts.loadAgentHosts();

    expect(agentHosts.resolveHost('unknown-agent', 'fallback.test')).toBe('fallback.test');
  });

  it('resolveHost returns the fallback for an undefined agent name', async () => {
    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });

    expect(agentHosts.resolveHost(undefined, 'fallback.test')).toBe('fallback.test');
  });

  it('resolveHost returns the fallback while the map is still loading', async () => {
    let resolveAgents: ((value: unknown) => void) | null = null;
    mockGetAgents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAgents = resolve;
        }),
    );

    const { useAgentHosts } = await loadComposable();
    const agentHosts = useAgentHosts({ autoLoad: false });
    const loadCall = agentHosts.loadAgentHosts();

    expect(agentHosts.resolveHost('agent-1', 'fallback.test')).toBe('fallback.test');

    resolveAgents?.([{ name: 'agent-1', connected: true, host: '10.0.0.5' }]);
    await loadCall;
  });

  it('coalesces concurrent loadAgentHosts calls into a single fetch', async () => {
    mockGetAgents.mockResolvedValueOnce([{ name: 'agent-1', connected: true, host: '10.0.0.5' }]);

    const { useAgentHosts } = await loadComposable();
    const first = useAgentHosts({ autoLoad: false });
    const second = useAgentHosts({ autoLoad: false });

    await Promise.all([first.loadAgentHosts(), second.loadAgentHosts()]);
    await first.loadAgentHosts();

    expect(mockGetAgents).toHaveBeenCalledTimes(1);
    expect(second.hostsByAgent.value).toEqual({ 'agent-1': '10.0.0.5' });
  });

  it('shares one auto-load request across repeated composable mounts', async () => {
    let resolveAgents: ((value: unknown) => void) | null = null;
    mockGetAgents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAgents = resolve;
        }),
    );

    const { useAgentHosts } = await loadComposable();
    const first = useAgentHosts();
    const second = useAgentHosts();

    expect(mockGetAgents).toHaveBeenCalledTimes(1);

    resolveAgents?.([{ name: 'agent-1', connected: true, host: '10.0.0.5' }]);
    await Promise.all([first.loadAgentHosts(), second.loadAgentHosts()]);

    const third = useAgentHosts();
    await third.loadAgentHosts();

    expect(mockGetAgents).toHaveBeenCalledTimes(1);
    expect(third.hostsByAgent.value).toEqual({ 'agent-1': '10.0.0.5' });
  });

  it('does not fetch when autoLoad is false', async () => {
    const { useAgentHosts } = await loadComposable();
    useAgentHosts({ autoLoad: false });

    expect(mockGetAgents).not.toHaveBeenCalled();
  });
});
