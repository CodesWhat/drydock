const mockGetMaturitySweepConfiguration = vi.hoisted(() => vi.fn());
const mockGetContainersRaw = vi.hoisted(() => vi.fn());
const mockCloneContainer = vi.hoisted(() => vi.fn((c: unknown) => structuredClone(c)));
const mockMaybeEmitMaturityGateCleared = vi.hoisted(() => vi.fn());
const mockCronSchedule = vi.hoisted(() => vi.fn());
const mockCronValidate = vi.hoisted(() => vi.fn());
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());

vi.mock('../configuration/index.js', () => ({
  getMaturitySweepConfiguration: mockGetMaturitySweepConfiguration,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      info: mockLogInfo,
      warn: mockLogWarn,
    }),
  },
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: unknown[]) => mockCronSchedule(...args),
    validate: (...args: unknown[]) => mockCronValidate(...args),
  },
}));

vi.mock('../store/container.js', () => ({
  getContainersRaw: (...args: unknown[]) => mockGetContainersRaw(...args),
  cloneContainer: (...args: unknown[]) => mockCloneContainer(...args),
}));

vi.mock('./gate-watch.js', () => ({
  maybeEmitMaturityGateCleared: (...args: unknown[]) => mockMaybeEmitMaturityGateCleared(...args),
}));

import { _resetForTesting, init, isRunning, runMaturitySweep, shutdown } from './scheduler.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  _resetForTesting();
  mockGetMaturitySweepConfiguration.mockReturnValue({ cron: '*/5 * * * *' });
  mockGetContainersRaw.mockReturnValue([]);
  mockCloneContainer.mockImplementation((c: unknown) => structuredClone(c));
  mockMaybeEmitMaturityGateCleared.mockResolvedValue(false);
});

describe('runMaturitySweep', () => {
  test('iterates only containers with a pending maturity marker', async () => {
    mockGetContainersRaw.mockReturnValue([
      createContainer({ id: 'c1', maturityGatePendingSince: '2026-05-01T00:00:00.000Z' }),
      createContainer({ id: 'c2' }),
      createContainer({ id: 'c3', maturityGatePendingSince: '' }),
      createContainer({ id: 'c4', maturityGatePendingSince: '2026-05-02T00:00:00.000Z' }),
    ]);

    await runMaturitySweep();

    expect(mockMaybeEmitMaturityGateCleared).toHaveBeenCalledTimes(2);
    expect(mockMaybeEmitMaturityGateCleared).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1' }),
    );
    expect(mockMaybeEmitMaturityGateCleared).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c4' }),
    );
  });

  test('clones each pending container before passing it to the detection helper', async () => {
    const pending = createContainer({
      id: 'c1',
      maturityGatePendingSince: '2026-05-01T00:00:00.000Z',
    });
    mockGetContainersRaw.mockReturnValue([pending]);

    await runMaturitySweep();

    expect(mockCloneContainer.mock.calls[0][0]).toEqual(pending);
  });

  test('does nothing when no containers are pending', async () => {
    mockGetContainersRaw.mockReturnValue([createContainer({ id: 'c1' })]);

    await runMaturitySweep();

    expect(mockMaybeEmitMaturityGateCleared).not.toHaveBeenCalled();
    expect(mockLogInfo).not.toHaveBeenCalledWith(
      expect.stringContaining('Maturity gate sweep complete'),
    );
  });

  test('logs the number of pending and cleared containers', async () => {
    mockGetContainersRaw.mockReturnValue([
      createContainer({ id: 'c1', maturityGatePendingSince: '2026-05-01T00:00:00.000Z' }),
      createContainer({ id: 'c2', maturityGatePendingSince: '2026-05-02T00:00:00.000Z' }),
    ]);
    mockMaybeEmitMaturityGateCleared.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await runMaturitySweep();

    expect(mockLogInfo).toHaveBeenCalledWith('Maturity gate sweep complete: 2 pending, 1 cleared');
  });

  test('logs and continues when the detection helper throws for a container', async () => {
    mockGetContainersRaw.mockReturnValue([
      createContainer({ id: 'c1', maturityGatePendingSince: '2026-05-01T00:00:00.000Z' }),
      createContainer({ id: 'c2', maturityGatePendingSince: '2026-05-02T00:00:00.000Z' }),
    ]);
    mockMaybeEmitMaturityGateCleared
      .mockRejectedValueOnce(new Error('store exploded'))
      .mockResolvedValueOnce(true);

    await runMaturitySweep();

    expect(mockLogWarn).toHaveBeenCalledWith(
      'Maturity gate sweep failed for container c1 (store exploded)',
    );
    expect(mockMaybeEmitMaturityGateCleared).toHaveBeenCalledTimes(2);
    expect(mockLogInfo).toHaveBeenCalledWith('Maturity gate sweep complete: 2 pending, 1 cleared');
  });

  test('skips a sweep already in progress', async () => {
    let resolveFirst: () => void;
    mockGetContainersRaw.mockReturnValue([
      createContainer({ id: 'c1', maturityGatePendingSince: '2026-05-01T00:00:00.000Z' }),
    ]);
    mockMaybeEmitMaturityGateCleared.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = () => resolve(false);
        }),
    );

    const firstSweep = runMaturitySweep();
    await Promise.resolve();
    const secondSweep = runMaturitySweep();

    resolveFirst!();
    await Promise.all([firstSweep, secondSweep]);

    expect(mockLogInfo).toHaveBeenCalledWith('Maturity gate sweep already in progress, skipping');
    expect(mockMaybeEmitMaturityGateCleared).toHaveBeenCalledTimes(1);
  });
});

describe('init', () => {
  test('creates a cron schedule when cron is configured', () => {
    mockCronValidate.mockReturnValue(true);
    const mockTask = { stop: vi.fn() };
    mockCronSchedule.mockReturnValue(mockTask);

    init();

    expect(mockCronValidate).toHaveBeenCalledWith('*/5 * * * *');
    expect(mockCronSchedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function));
    expect(isRunning()).toBe(true);
    expect(mockLogInfo).toHaveBeenCalledWith('Maturity gate sweep enabled (cron: */5 * * * *)');
  });

  test('no-ops when cron is not configured', () => {
    mockGetMaturitySweepConfiguration.mockReturnValue({ cron: '' });

    init();

    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Maturity gate sweep not configured (DD_MATURITY_SWEEP_CRON is empty)',
    );
  });

  test('warns and returns when the cron expression is invalid', () => {
    mockCronValidate.mockReturnValue(false);

    init();

    expect(mockCronValidate).toHaveBeenCalledWith('*/5 * * * *');
    expect(mockCronSchedule).not.toHaveBeenCalled();
    expect(isRunning()).toBe(false);
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Invalid cron expression for DD_MATURITY_SWEEP_CRON: "*/5 * * * *"',
    );
  });

  test('invokes runMaturitySweep when the cron fires', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    mockGetContainersRaw.mockReturnValue([]);

    init();
    cronCallback!();

    await vi.waitFor(() => {
      expect(mockGetContainersRaw).toHaveBeenCalled();
    });
  });

  test('catches errors thrown by runMaturitySweep in the cron callback', async () => {
    mockCronValidate.mockReturnValue(true);
    let cronCallback: () => void;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return { stop: vi.fn() };
    });
    mockGetContainersRaw.mockImplementation(() => {
      throw new Error('sweep exploded');
    });

    init();
    cronCallback!();

    await vi.waitFor(() => {
      expect(mockLogWarn).toHaveBeenCalledWith('Maturity gate sweep run failed: sweep exploded');
    });
  });
});

describe('shutdown', () => {
  test('stops the cron task and resets state', () => {
    mockCronValidate.mockReturnValue(true);
    const mockTask = { stop: vi.fn() };
    mockCronSchedule.mockReturnValue(mockTask);

    init();
    expect(isRunning()).toBe(true);

    shutdown();

    expect(mockTask.stop).toHaveBeenCalled();
    expect(isRunning()).toBe(false);
  });

  test('is safe to call when no cron task is active', () => {
    shutdown();

    expect(isRunning()).toBe(false);
  });
});

describe('_resetForTesting', () => {
  test('fully resets scheduler state', () => {
    mockCronValidate.mockReturnValue(true);
    const mockTask = { stop: vi.fn() };
    mockCronSchedule.mockReturnValue(mockTask);

    init();
    expect(isRunning()).toBe(true);

    _resetForTesting();

    expect(isRunning()).toBe(false);
    expect(mockTask.stop).toHaveBeenCalled();
  });
});
