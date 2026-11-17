import type { Container } from '../../../model/container.js';

const mockGetContainer = vi.hoisted(() => vi.fn());
const mockGetOperations = vi.hoisted(() => vi.fn());
const mockEmit = vi.hoisted(() => vi.fn());

vi.mock('../../../store/container.js', () => ({ getContainer: mockGetContainer }));
vi.mock('../../../store/update-operation.js', () => ({
  getOperationsByContainerId: mockGetOperations,
}));
vi.mock('../../../event/index.js', () => ({ emitContainerStateAlert: mockEmit }));

import {
  ContainerStateAlertTracker,
  createContainerStateAlertTracker,
  getRestartLoopConfigurationSchema,
  isDrydockInitiatedStateChange,
  STATE_ALERT_SETTLE_MS,
} from './container-state-alerts.js';

const container = { id: 'c1', name: 'web', watcher: 'local' } as Container;

function dockerEvent(action: string, attributes: Record<string, string> = {}, id = 'c1') {
  return { Type: 'container', Action: action, Actor: { ID: id, Attributes: attributes } };
}

function build(
  overrides: Partial<ConstructorParameters<typeof ContainerStateAlertTracker>[0]> = {},
  options = {},
) {
  const emit = vi.fn().mockResolvedValue(undefined);
  const deps = {
    getContainer: vi.fn(() => container as Container | undefined),
    inspectContainer: vi.fn().mockResolvedValue({ State: {} }),
    isDrydockInitiated: vi.fn(() => false),
    emit,
    log: { debug: vi.fn() },
    ...overrides,
  };
  return { tracker: new ContainerStateAlertTracker(deps, options), deps, emit };
}

const settle = () => vi.advanceTimersByTimeAsync(STATE_ALERT_SETTLE_MS + 10);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ContainerStateAlertTracker', () => {
  test('a non-zero exit alerts container-exited with the exit code', async () => {
    const { tracker, emit } = build();
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'container-exited',
        exitCode: 1,
        reason: 'exit code 1',
        containerName: 'web',
      }),
    );
  });

  test('a clean exit alerts container-stopped', async () => {
    const { tracker, emit } = build();
    tracker.observe(dockerEvent('die', { exitCode: '0' }));
    await settle();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'container-stopped', exitCode: 0 }),
    );
  });

  test('an explicit stop is container-stopped even with a signal exit code, and is not a crash', async () => {
    const { tracker, emit } = build();
    tracker.observe(dockerEvent('die', { exitCode: '137' }));
    tracker.observe(dockerEvent('stop'));
    await settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'container-stopped', exitCode: 137 }),
    );
  });

  test('oom and die for one crash produce a single container-oom-killed alert', async () => {
    const { tracker, emit } = build();
    tracker.observe(dockerEvent('oom'));
    tracker.observe(dockerEvent('die', { exitCode: '137' }));
    await settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'container-oom-killed', exitCode: 137 }),
    );
  });

  test('die alone is upgraded to oom-killed when inspect reports State.OOMKilled', async () => {
    const { tracker, emit } = build({
      inspectContainer: vi.fn().mockResolvedValue({ State: { OOMKilled: true, ExitCode: 137 } }),
    });
    tracker.observe(dockerEvent('die'));
    await settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'container-oom-killed', exitCode: 137 }),
    );
  });

  test('falls back to the event data when inspect fails', async () => {
    const { tracker, emit } = build({
      inspectContainer: vi.fn().mockRejectedValue(new Error('no such container')),
    });
    tracker.observe(dockerEvent('die', { exitCode: '2' }));
    await settle();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'container-exited' }));
  });

  test('containers Drydock does not watch never alert', async () => {
    const { tracker, emit, deps } = build({ getContainer: vi.fn(() => undefined) });
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).not.toHaveBeenCalled();
    expect(deps.inspectContainer).not.toHaveBeenCalled();
  });

  test('stops Drydock performs during an update or rollback are suppressed', async () => {
    const { tracker, emit } = build({ isDrydockInitiated: vi.fn(() => true) });
    tracker.observe(dockerEvent('die', { exitCode: '137' }));
    tracker.observe(dockerEvent('stop'));
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });

  test('rollback-renamed containers are suppressed', async () => {
    const { tracker, emit } = build({
      getContainer: vi.fn(() => ({ ...container, name: 'web-old-1700000000000' }) as Container),
    });
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });

  test('suppressed update-time crashes do not count toward a restart loop', async () => {
    let initiated = true;
    const { tracker, emit } = build({ isDrydockInitiated: vi.fn(() => initiated) });
    for (let i = 0; i < 4; i++) {
      tracker.observe(dockerEvent('die', { exitCode: '1' }));
      await settle();
    }
    initiated = false;
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'container-exited' }));
  });

  test('three crashes inside the window alert once as a restart loop, then pause per-crash alerts', async () => {
    const { tracker, emit } = build();
    for (let i = 0; i < 5; i++) {
      tracker.observe(dockerEvent('die', { exitCode: '1' }));
      await settle();
    }
    const kinds = emit.mock.calls.map(([payload]) => payload.kind);
    expect(kinds).toEqual(['container-exited', 'container-exited', 'container-restart-loop']);
    expect(emit.mock.calls[2][0]).toMatchObject({
      restartCount: 3,
      windowSeconds: 300,
      exitCode: 1,
    });
  });

  test('crashes spread beyond the window do not make a loop', async () => {
    const { tracker, emit } = build();
    for (let i = 0; i < 4; i++) {
      tracker.observe(dockerEvent('die', { exitCode: '1' }));
      await settle();
      await vi.advanceTimersByTimeAsync(200_000);
    }
    expect(emit.mock.calls.every(([payload]) => payload.kind === 'container-exited')).toBe(true);
  });

  test('threshold and window are configurable', async () => {
    const { tracker, emit } = build({}, { restartLoopThreshold: 2, restartLoopWindowSeconds: 60 });
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'container-restart-loop',
        restartCount: 2,
        windowSeconds: 60,
      }),
    );
  });

  test('a loop is reported again after the window passes', async () => {
    const { tracker, emit } = build({}, { restartLoopThreshold: 2, restartLoopWindowSeconds: 60 });
    const crash = async () => {
      tracker.observe(dockerEvent('die', { exitCode: '1' }));
      await settle();
    };
    await crash();
    await crash();
    await vi.advanceTimersByTimeAsync(61_000);
    await crash();
    await crash();
    const loops = emit.mock.calls.filter(([p]) => p.kind === 'container-restart-loop');
    expect(loops).toHaveLength(2);
  });

  test('ignores unrelated events, a lone stop, and events without a container id', async () => {
    const { tracker, emit } = build();
    tracker.observe(null);
    tracker.observe('die');
    tracker.observe(dockerEvent('start'));
    tracker.observe(dockerEvent('stop'));
    tracker.observe({ Action: 'die', Actor: {} });
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });

  test('reads the top-level id and status fields used by older engines', async () => {
    const { tracker, emit } = build();
    tracker.observe({ status: 'die', id: 'c1', Actor: { Attributes: { exitCode: '3' } } });
    await settle();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 3 }));
  });

  test('an evaluation failure is logged and swallowed', async () => {
    const { tracker, emit, deps } = build({ emit: vi.fn().mockRejectedValue(new Error('boom')) });
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).not.toHaveBeenCalled();
    expect(deps.log.debug).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  test('dispose cancels pending alerts and ignores later events', async () => {
    const { tracker, emit } = build();
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    tracker.dispose();
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(emit).not.toHaveBeenCalled();
  });

  test('uses the injected clock', async () => {
    const now = vi.fn(() => 1000);
    const { tracker, emit } = build({ now }, { restartLoopThreshold: 2 });
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(now).toHaveBeenCalled();
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'container-restart-loop' }),
    );
  });
});

describe('isDrydockInitiatedStateChange', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');

  test.each([
    { label: 'an in-progress operation', ops: [{ status: 'in-progress' }], expected: true },
    { label: 'a queued operation', ops: [{ status: 'queued' }], expected: false },
    {
      label: 'a rollback that just finished',
      ops: [{ status: 'rolled-back', completedAt: '2026-11-17T11:59:30.000Z' }],
      expected: true,
    },
    {
      label: 'an old terminal operation',
      ops: [{ status: 'succeeded', completedAt: '2026-11-17T11:00:00.000Z' }],
      expected: false,
    },
    { label: 'no operations', ops: [], expected: false },
  ])('$label => $expected', ({ ops, expected }) => {
    mockGetOperations.mockReturnValue(ops);
    expect(isDrydockInitiatedStateChange(container, now)).toBe(expected);
  });
});

describe('createContainerStateAlertTracker', () => {
  test('wires the store, the inspect call, operations and the event emitter', async () => {
    mockGetContainer.mockReturnValue(container);
    mockGetOperations.mockReturnValue([]);
    mockEmit.mockResolvedValue(undefined);
    const inspect = vi.fn().mockResolvedValue({ State: { OOMKilled: false } });
    const tracker = createContainerStateAlertTracker({
      dockerApi: { getContainer: () => ({ inspect }) },
      log: { debug: vi.fn() },
      configuration: { restartloop: { threshold: 2, window: 30 } },
    });
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    tracker.observe(dockerEvent('die', { exitCode: '1' }));
    await settle();
    expect(inspect).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'container-restart-loop', windowSeconds: 30 }),
    );
    tracker.dispose();
  });
});

test('restart loop configuration schema enforces sane bounds', async () => {
  const { default: Joi } = await import('joi');
  const schema = getRestartLoopConfigurationSchema(Joi);
  expect(schema.validate({ threshold: 3, window: 300 }).error).toBeUndefined();
  expect(schema.validate({ threshold: 1 }).error).toBeDefined();
  expect(schema.validate({ window: 0 }).error).toBeDefined();
});
