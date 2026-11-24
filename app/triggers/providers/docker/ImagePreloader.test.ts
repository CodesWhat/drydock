import type { Container } from '../../../model/container.js';
import {
  getImagePreload,
  getImagePreloadView,
  peekImagePreload,
  resetImagePreloads,
} from '../../../updates/image-preload-state.js';
import ImagePreloader, {
  type ImagePreloaderHost,
  PRELOAD_RETRY_AFTER_MS,
  resolvePreloadMode,
} from './ImagePreloader.js';

const mocks = vi.hoisted(() => ({
  registerContainerReport: vi.fn(),
  registerContainerRemoved: vi.fn(),
  getState: vi.fn(),
  getUpdateMode: vi.fn(),
  getActiveOperationByContainerId: vi.fn(),
  selectActionTrigger: vi.fn(),
  classifyApprovalCandidate: vi.fn(),
  computeUpdateEligibility: vi.fn(),
  getContainerMaintenanceWindowOpen: vi.fn(),
}));

vi.mock('../../../event/index.js', () => ({
  registerContainerReport: mocks.registerContainerReport,
  registerContainerRemoved: mocks.registerContainerRemoved,
}));
vi.mock('../../../registry/index.js', () => ({ getState: mocks.getState }));
vi.mock('../../../store/settings.js', () => ({ getUpdateMode: mocks.getUpdateMode }));
vi.mock('../../../store/update-operation.js', () => ({
  getActiveOperationByContainerId: mocks.getActiveOperationByContainerId,
}));
vi.mock('../../../model/action-policy.js', () => ({
  selectActionTrigger: mocks.selectActionTrigger,
}));
vi.mock('../../../model/approval.js', () => ({
  classifyApprovalCandidate: mocks.classifyApprovalCandidate,
}));
vi.mock('../../../model/update-eligibility.js', () => ({
  computeUpdateEligibility: mocks.computeUpdateEligibility,
}));
vi.mock('../../../model/watcher-maintenance-window.js', () => ({
  getContainerMaintenanceWindowOpen: mocks.getContainerMaintenanceWindowOpen,
}));

function makeContainer(overrides: Record<string, unknown> = {}): Container {
  return {
    id: 'c1',
    name: 'web',
    watcher: 'local',
    image: {
      name: 'org/web',
      registry: { name: 'hub', url: 'registry-1.docker.io' },
      tag: { value: '1.0.0' },
    },
    result: { tag: '1.1.0', digest: 'sha256:aaa' },
    labels: {},
    ...overrides,
  } as unknown as Container;
}

function makeHost(configuration: Record<string, unknown> = { preload: true }) {
  const dockerApi = { id: 'api' };
  const registry = {
    getAuthPull: vi.fn().mockResolvedValue({ username: 'u' }),
    getImageFullName: vi.fn((_image: unknown, ref: string) => `org/web@${ref}`),
  };
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const host = {
    getId: () => 'docker.main',
    log,
    configuration,
    getWatcher: vi.fn(() => ({ dockerApi })),
    resolveRegistryManager: vi.fn(() => registry),
    getNewImageFullName: vi.fn(() => 'org/web:1.1.0'),
    isImageOnHost: vi.fn().mockResolvedValue(false),
    pullImage: vi.fn().mockResolvedValue(undefined),
  };
  return { host, dockerApi, registry, log };
}

function arrange(configuration?: Record<string, unknown>) {
  const parts = makeHost(configuration);
  const preloader = new ImagePreloader(parts.host as unknown as ImagePreloaderHost);
  return { ...parts, preloader };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetImagePreloads();
  mocks.getState.mockReturnValue({ trigger: {}, watcher: {} });
  mocks.getUpdateMode.mockReturnValue('auto');
  mocks.getActiveOperationByContainerId.mockReturnValue(undefined);
  mocks.selectActionTrigger.mockReturnValue({ triggerId: 'docker.main', state: 'manual' });
  mocks.computeUpdateEligibility.mockReturnValue({ eligible: true, blockers: [] });
  mocks.classifyApprovalCandidate.mockReturnValue('queue');
  mocks.getContainerMaintenanceWindowOpen.mockReturnValue(undefined);
});

describe('resolvePreloadMode', () => {
  test.each([
    [{}, 'off'],
    [{ preload: false }, 'off'],
    [{ preload: true }, 'all'],
    [{ preload: 'label' as const }, 'label'],
  ])('%j -> %s', (configuration, mode) => {
    expect(resolvePreloadMode(configuration)).toBe(mode);
  });
});

describe('registration', () => {
  test('registers nothing while preload is off', () => {
    const { preloader } = arrange({ preload: false });
    preloader.start();
    expect(mocks.registerContainerReport).not.toHaveBeenCalled();
    preloader.stop();
  });

  test('registers the report and removal handlers and unregisters them on stop', async () => {
    const offReport = vi.fn();
    const offRemoved = vi.fn();
    mocks.registerContainerReport.mockReturnValue(offReport);
    mocks.registerContainerRemoved.mockReturnValue(offRemoved);
    const { preloader, host } = arrange();
    preloader.start();
    expect(mocks.registerContainerReport).toHaveBeenCalledWith(expect.any(Function), {
      id: 'docker.main.preload',
      order: undefined,
    });
    const reportHandler = mocks.registerContainerReport.mock.calls[0][0];
    await reportHandler({ container: makeContainer() });
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);

    const removedHandler = mocks.registerContainerRemoved.mock.calls[0][0];
    removedHandler(makeContainer());
    expect(peekImagePreload(makeContainer())).toBeUndefined();

    preloader.stop();
    expect(offReport).toHaveBeenCalledTimes(1);
    expect(offRemoved).toHaveBeenCalledTimes(1);
    preloader.stop();
    expect(offReport).toHaveBeenCalledTimes(1);
  });
});

describe('held updates preload without touching the running container', () => {
  test('manual-only update is pulled by immutable digest and recorded', async () => {
    const { preloader, host, dockerApi, registry } = arrange();
    const container = makeContainer();
    await preloader.handleReport(container);
    expect(getImagePreload(container)?.status).toBe('pending');
    await preloader.idle();

    expect(host.pullImage).toHaveBeenCalledWith(
      dockerApi,
      { username: 'u' },
      'org/web@sha256:aaa',
      host.log,
    );
    expect(registry.getImageFullName).toHaveBeenCalledWith(container.image, 'sha256:aaa');
    expect(getImagePreloadView(container)).toEqual({
      status: 'done',
      image: 'org/web@sha256:aaa',
      digest: 'sha256:aaa',
      updatedAt: expect.any(String),
    });
    // Only image calls are made on the host: nothing stops or recreates the container.
    expect(Object.keys(dockerApi)).toEqual(['id']);
  });

  test.each([
    ['approval pending', [], 'queue'],
    ['maintenance window closed', [{ reason: 'maintenance-window-closed' }], 'auto-dispatch'],
    ['maturity not reached', [{ reason: 'maturity-not-reached' }], 'auto-dispatch'],
    ['release maturity not reached', [{ reason: 'maturity-releases-not-reached' }], 'queue'],
  ])('%s preloads', async (_name, blockers, verdict) => {
    mocks.computeUpdateEligibility.mockReturnValue({ eligible: false, blockers });
    mocks.classifyApprovalCandidate.mockReturnValue(verdict);
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
  });

  test('reuses a digest already on the host without pulling', async () => {
    const { preloader, host } = arrange();
    host.isImageOnHost.mockResolvedValue(true);
    const container = makeContainer();
    await preloader.handleReport(container);
    await preloader.idle();
    expect(host.pullImage).not.toHaveBeenCalled();
    expect(getImagePreload(container)?.status).toBe('done');
  });

  test('without a digest the tag reference is pulled', async () => {
    const { preloader, host } = arrange();
    const container = makeContainer({ result: { tag: '1.1.0' } });
    await preloader.handleReport(container);
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org/web:1.1.0',
      host.log,
    );
    expect(getImagePreloadView(container)?.digest).toBeUndefined();
  });

  test('an update that installs on its own is not preloaded', async () => {
    mocks.classifyApprovalCandidate.mockReturnValue('auto-dispatch');
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer());
    expect(host.pullImage).not.toHaveBeenCalled();
  });
});

describe('candidate change', () => {
  test('a new digest is preloaded and the stale one is not reported', async () => {
    const { preloader, host } = arrange();
    const first = makeContainer();
    await preloader.handleReport(first);
    await preloader.idle();
    expect(getImagePreload(first)?.digest).toBe('sha256:aaa');

    const second = makeContainer({ result: { tag: '1.1.0', digest: 'sha256:bbb' } });
    expect(getImagePreload(second)).toBeUndefined();
    await preloader.handleReport(second);
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(2);
    expect(getImagePreload(second)?.digest).toBe('sha256:bbb');
  });

  test('a pull that finishes after the candidate moved does not overwrite the newer entry', async () => {
    const { preloader, host } = arrange({ preload: true, preloadconcurrency: 2 });
    let finishFirst: () => void = () => undefined;
    host.pullImage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    const first = makeContainer();
    await preloader.handleReport(first);
    await vi.waitFor(() => expect(host.pullImage).toHaveBeenCalledTimes(1));

    const second = makeContainer({ result: { tag: '1.1.0', digest: 'sha256:bbb' } });
    await preloader.handleReport(second);
    await vi.waitFor(() => expect(getImagePreload(second)?.status).toBe('done'));

    finishFirst();
    await preloader.idle();
    expect(peekImagePreload(second)?.candidate).toBe('sha256:bbb');
    expect(getImagePreload(second)?.status).toBe('done');
  });

  test('a withdrawn candidate clears the recorded preload', async () => {
    const { preloader } = arrange();
    const container = makeContainer();
    await preloader.handleReport(container);
    await preloader.idle();
    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    expect(peekImagePreload(container)).toBeUndefined();
  });

  test('an unchanged candidate is not pulled again', async () => {
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
  });

  test('a container without any candidate identity is ignored', async () => {
    const { preloader, host } = arrange();
    const container = makeContainer({ result: { created: '2026-01-01' } });
    // @ts-expect-error force the candidate path directly
    await preloader.preload(container);
    expect(host.pullImage).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  test('a failed pull is recorded, logged and retried only after the cool-down', async () => {
    vi.useFakeTimers();
    try {
      const { preloader, host, log } = arrange();
      host.pullImage.mockRejectedValueOnce(new Error('boom'));
      const container = makeContainer();
      await preloader.handleReport(container);
      await preloader.idle();
      expect(getImagePreloadView(container)).toMatchObject({ status: 'failed', error: 'boom' });
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));

      await preloader.handleReport(container);
      await preloader.idle();
      expect(host.pullImage).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(PRELOAD_RETRY_AFTER_MS + 1);
      await preloader.handleReport(container);
      await preloader.idle();
      expect(host.pullImage).toHaveBeenCalledTimes(2);
      expect(getImagePreload(container)?.status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('enablement and labels', () => {
  test('off never preloads', () => {
    const { preloader } = arrange({ preload: false });
    expect(preloader.evaluate(makeContainer())).toEqual({
      preload: false,
      reason: 'preload not enabled for this container',
    });
  });

  test('label=false opts a container out when enabled for all', () => {
    const { preloader } = arrange();
    const container = makeContainer({ labels: { 'dd.update.preload': 'false' } });
    expect(preloader.evaluate(container).preload).toBe(false);
  });

  test('label mode needs dd.update.preload=true', () => {
    const { preloader } = arrange({ preload: 'label' });
    expect(preloader.evaluate(makeContainer()).preload).toBe(false);
    expect(
      preloader.evaluate(makeContainer({ labels: { 'dd.update.preload': 'maybe' } })).preload,
    ).toBe(false);
    expect(
      preloader.evaluate(makeContainer({ labels: { 'dd.update.preload': ' TRUE ' } })).preload,
    ).toBe(true);
  });

  test('a label cannot enable preload while the option is off', () => {
    const { preloader } = arrange({ preload: false });
    expect(
      preloader.evaluate(makeContainer({ labels: { 'dd.update.preload': 'true' } })).preload,
    ).toBe(false);
  });

  test('missing labels object is treated as unset', () => {
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer({ labels: undefined })).preload).toBe(true);
  });
});

describe('never preloaded', () => {
  test('dd.action.exclude (blocked by policy)', () => {
    mocks.selectActionTrigger.mockReturnValue({
      triggerId: 'docker.main',
      state: 'blocked',
      reason: 'excluded',
    });
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer())).toEqual({
      preload: false,
      reason: 'excluded from this action (excluded)',
    });
  });

  test('another action owns the container, or none does', () => {
    const { preloader } = arrange();
    mocks.selectActionTrigger.mockReturnValue({ triggerId: 'docker.other', state: 'manual' });
    expect(preloader.evaluate(makeContainer()).preload).toBe(false);
    mocks.selectActionTrigger.mockReturnValue(undefined);
    expect(preloader.evaluate(makeContainer()).preload).toBe(false);
  });

  test('local builds', () => {
    const { preloader } = arrange();
    const container = makeContainer();
    container.image.isLocalImage = true;
    expect(preloader.evaluate(container)).toMatchObject({
      reason: expect.stringContaining('local'),
    });
  });

  test('agent containers skip with a reason', () => {
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer({ agent: 'edge' }))).toEqual({
      preload: false,
      reason: 'agent container (the agent preloads on its own host)',
    });
  });

  test('synthetic containers without a Docker watcher', () => {
    const { preloader, host } = arrange();
    host.getWatcher.mockImplementation(() => {
      throw new Error('No watcher');
    });
    expect(preloader.evaluate(makeContainer())).toEqual({
      preload: false,
      reason: 'no Docker watcher owns this container',
    });
    host.getWatcher.mockReturnValue({ dockerApi: undefined } as never);
    expect(preloader.evaluate(makeContainer()).preload).toBe(false);
  });

  test('containers with no update candidate', async () => {
    const { preloader, host } = arrange();
    const container = makeContainer({ result: undefined });
    expect(preloader.evaluate(container)).toEqual({
      preload: false,
      reason: 'no update candidate',
    });
    await preloader.handleReport(container);
    expect(host.pullImage).not.toHaveBeenCalled();
  });

  test('eligibility is computed with no active operation of its own', async () => {
    const { preloader } = arrange();
    preloader.evaluate(makeContainer());
    const context = mocks.computeUpdateEligibility.mock.calls[0][1];
    expect(context.getActiveOperation()).toBeUndefined();
  });

  test('an update already running', () => {
    mocks.getActiveOperationByContainerId.mockReturnValue({ id: 'op' });
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer()).preload).toBe(false);
  });

  test.each([['snoozed'], ['skip-tag'], ['security-scan-blocked'], ['threshold-not-reached']])(
    '%s is not a hold',
    (reason) => {
      mocks.computeUpdateEligibility.mockReturnValue({ eligible: false, blockers: [{ reason }] });
      const { preloader } = arrange();
      expect(preloader.evaluate(makeContainer())).toEqual({
        preload: false,
        reason: `update not wanted (${reason})`,
      });
    },
  );

  test.each(['blocked', 'no-candidate'])('approval verdict %s', (verdict) => {
    mocks.classifyApprovalCandidate.mockReturnValue(verdict);
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer())).toEqual({
      preload: false,
      reason: `update not wanted (${verdict})`,
    });
  });
});

describe('limits', () => {
  test('concurrent preloads per host are bounded and the rest wait for the next scan', async () => {
    const { preloader, host, log } = arrange({ preload: true, preloadconcurrency: 1 });
    let finish: () => void = () => undefined;
    host.pullImage.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await preloader.handleReport(makeContainer());
    await vi.waitFor(() => expect(host.pullImage).toHaveBeenCalledTimes(1));

    const other = makeContainer({ id: 'c2', name: 'api' });
    await preloader.handleReport(other);
    await vi.waitFor(() =>
      expect(log.debug).toHaveBeenCalledWith(
        expect.stringContaining('1 preload(s) already running'),
      ),
    );
    expect(host.pullImage).toHaveBeenCalledTimes(1);
    expect(peekImagePreload(other)).toBeUndefined();

    finish();
    await preloader.idle();
    await preloader.handleReport(other);
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(2);
  });

  test('retained preloads per host are capped', async () => {
    const { preloader, host, log } = arrange({ preload: true, preloadmaxcandidates: 1 });
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    const other = makeContainer({ id: 'c2', name: 'api' });
    await preloader.handleReport(other);
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('already holds 1'));
    expect(peekImagePreload(other)).toBeUndefined();

    // A different host has its own budget.
    const remote = makeContainer({ id: 'c3', name: 'db', watcher: 'remote' });
    await preloader.handleReport(remote);
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(2);
  });

  test('defaults apply when limits are not configured', async () => {
    const { preloader, host } = arrange({ preload: true });
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
  });

  test('a host with an agent name keeps its own budget key', async () => {
    const { preloader } = arrange();
    const container = makeContainer();
    await preloader.handleReport(container);
    await preloader.idle();
    expect(peekImagePreload(container)?.host).toBe('local.local');
  });
});
