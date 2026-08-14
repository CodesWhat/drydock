const {
  mockGetContainer,
  mockUpdateContainer,
  mockGetState,
  mockInsertAudit,
  mockGetAuditCounter,
} = vi.hoisted(() => ({
  mockGetContainer: vi.fn(),
  mockUpdateContainer: vi.fn((c) => c),
  mockGetState: vi.fn(),
  mockInsertAudit: vi.fn(),
  mockGetAuditCounter: vi.fn(() => ({ inc: vi.fn() })),
}));

vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
  updateContainer: mockUpdateContainer,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../store/audit.js', () => ({
  insertAudit: mockInsertAudit,
}));

vi.mock('../prometheus/audit.js', () => ({
  getAuditCounter: mockGetAuditCounter,
}));

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import { restartDependentContainer } from './dependency-restart.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'tdarr-node',
    watcher: 'local',
    image: { name: 'tdarr-node' },
    ...overrides,
  };
}

function createDockerTrigger(overrides: Record<string, unknown> = {}) {
  const mockDockerContainer = {
    restart: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Status: 'running' } }),
  };
  return {
    trigger: {
      type: 'docker',
      getWatcher: vi.fn(() => ({
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      })),
      ...overrides,
    },
    dockerContainer: mockDockerContainer,
  };
}

describe('restartDependentContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateContainer.mockImplementation((c) => c);
    mockGetAuditCounter.mockReturnValue({ inc: vi.fn() });
  });

  test('restarts the container via its docker trigger and records a success audit event', async () => {
    const { trigger, dockerContainer } = createDockerTrigger();
    mockGetState.mockReturnValue({ trigger: { docker1: trigger } });
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    await restartDependentContainer(container as never);

    expect(dockerContainer.restart).toHaveBeenCalled();
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'container-restart', status: 'success' }),
    );
  });

  test('refreshes the stored container status from the post-restart inspect result', async () => {
    const { trigger } = createDockerTrigger();
    mockGetState.mockReturnValue({ trigger: { docker1: trigger } });
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    await restartDependentContainer(container as never);

    expect(mockUpdateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', status: 'running' }),
    );
  });

  test('throws when no docker trigger is configured for the container', async () => {
    mockGetState.mockReturnValue({ trigger: {} });
    const container = createContainer();

    await expect(restartDependentContainer(container as never)).rejects.toThrow(
      'No docker trigger found for this container',
    );
  });

  test('does not fail the restart when the post-restart status refresh throws', async () => {
    const { trigger, dockerContainer } = createDockerTrigger();
    dockerContainer.inspect.mockRejectedValue(new Error('inspect failed'));
    mockGetState.mockReturnValue({ trigger: { docker1: trigger } });
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    await expect(restartDependentContainer(container as never)).resolves.toBeUndefined();
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'container-restart', status: 'success' }),
    );
  });

  test('does not fail the restart when the post-restart status refresh throws a non-Error value', async () => {
    const { trigger, dockerContainer } = createDockerTrigger();
    dockerContainer.inspect.mockRejectedValue('boom');
    mockGetState.mockReturnValue({ trigger: { docker1: trigger } });
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    await expect(restartDependentContainer(container as never)).resolves.toBeUndefined();
  });

  test('skips the store refresh when inspect reports no status', async () => {
    const { trigger, dockerContainer } = createDockerTrigger();
    dockerContainer.inspect.mockResolvedValue({ State: {} });
    mockGetState.mockReturnValue({ trigger: { docker1: trigger } });
    const container = createContainer();
    mockGetContainer.mockReturnValue(container);

    await restartDependentContainer(container as never);

    expect(mockUpdateContainer).not.toHaveBeenCalled();
  });

  test('skips the store refresh when the container is no longer in the store', async () => {
    const { trigger } = createDockerTrigger();
    mockGetState.mockReturnValue({ trigger: { docker1: trigger } });
    const container = createContainer();
    mockGetContainer.mockReturnValue(undefined);

    await restartDependentContainer(container as never);

    expect(mockUpdateContainer).not.toHaveBeenCalled();
  });
});
