import type { Container } from '../../../model/container.js';
import {
  countRetainedImagePreloads,
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
  chooseApprovalCandidate: vi.fn(),
  resolveUpdateModeCeiling: vi.fn(),
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
  chooseApprovalCandidate: mocks.chooseApprovalCandidate,
}));
vi.mock('../../../model/group-policy.js', () => ({
  resolveUpdateModeCeiling: mocks.resolveUpdateModeCeiling,
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
    removeImage: vi.fn().mockResolvedValue(undefined),
    isRollbackTag: vi.fn().mockReturnValue(false),
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
  mocks.chooseApprovalCandidate.mockImplementation((container: Container) => container);
  mocks.resolveUpdateModeCeiling.mockReturnValue({ value: 'auto', source: 'global' });
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
    await preloader.idle();
    expect(peekImagePreload(makeContainer())).toBeUndefined();
    expect(host.removeImage).toHaveBeenCalledTimes(1);

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
    await preloader.idle();
    expect(peekImagePreload(container)).toBeUndefined();
  });

  test('an unchanged candidate is not pulled again', async () => {
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    host.isImageOnHost.mockResolvedValue(true);
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
    const other = makeContainer({
      id: 'c2',
      name: 'api',
      result: { tag: '1.1.0', digest: 'sha256:ccc' },
    });
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

  test('containers sharing one image reference count once against the cap', async () => {
    const { preloader, host } = arrange({ preload: true, preloadmaxcandidates: 1 });
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    host.isImageOnHost.mockResolvedValue(true);
    await preloader.handleReport(makeContainer({ id: 'c2', name: 'api' }));
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
    expect(countRetainedImagePreloads('local.local')).toBe(1);
  });

  test('defaults apply when limits are not configured', async () => {
    const { preloader, host } = arrange({ preload: true });
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
  });

  test('the budget key is the local watcher', async () => {
    const { preloader } = arrange();
    const container = makeContainer();
    await preloader.handleReport(container);
    await preloader.idle();
    expect(peekImagePreload(container)?.host).toBe('local.local');
  });
});

const withDigest = (digest: string, overrides: Record<string, unknown> = {}) =>
  makeContainer({ result: { tag: '1.1.0', digest }, ...overrides });

describe('retained image accounting', () => {
  test('replacing the candidate removes the superseded image so the cap holds', async () => {
    const { preloader, host, dockerApi } = arrange({ preload: true, preloadmaxcandidates: 1 });
    for (const digest of ['sha256:aaa', 'sha256:bbb', 'sha256:ccc']) {
      await preloader.handleReport(withDigest(digest));
      await preloader.idle();
    }
    expect(host.pullImage).toHaveBeenCalledTimes(3);
    expect(host.removeImage.mock.calls.map((call) => call[1])).toEqual([
      'org/web@sha256:aaa',
      'org/web@sha256:bbb',
    ]);
    expect(host.removeImage).toHaveBeenCalledWith(dockerApi, 'org/web@sha256:aaa', host.log);
    expect(countRetainedImagePreloads('local.local')).toBe(1);
    expect(getImagePreload(withDigest('sha256:ccc'))?.status).toBe('done');
  });

  test('a failed removal keeps the reference counted and defers the new pull', async () => {
    const { preloader, host, log } = arrange({ preload: true, preloadmaxcandidates: 1 });
    await preloader.handleReport(withDigest('sha256:aaa'));
    await preloader.idle();
    host.removeImage.mockRejectedValueOnce(new Error('daemon down'));

    await preloader.handleReport(withDigest('sha256:bbb'));
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
    expect(countRetainedImagePreloads('local.local')).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be removed'));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Preload deferred'));
    expect(peekImagePreload(withDigest('sha256:bbb'))?.candidate).toBe('sha256:aaa');

    await preloader.handleReport(withDigest('sha256:bbb'));
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(2);
    expect(getImagePreload(withDigest('sha256:bbb'))?.status).toBe('done');
    expect(countRetainedImagePreloads('local.local')).toBe(1);
  });

  test.each([404, 409])(
    'a %s from the daemon means the image is no longer a preload',
    async (statusCode) => {
      const { preloader, host } = arrange({ preload: true, preloadmaxcandidates: 1 });
      await preloader.handleReport(withDigest('sha256:aaa'));
      await preloader.idle();
      host.removeImage.mockRejectedValueOnce(Object.assign(new Error('nope'), { statusCode }));
      await preloader.handleReport(withDigest('sha256:bbb'));
      await preloader.idle();
      expect(host.pullImage).toHaveBeenCalledTimes(2);
      expect(countRetainedImagePreloads('local.local')).toBe(1);
    },
  );

  test('a removal that rejects without an error object still defers', async () => {
    const { preloader, host } = arrange();
    await preloader.handleReport(withDigest('sha256:aaa'));
    await preloader.idle();
    host.removeImage.mockRejectedValueOnce(undefined);
    await preloader.handleReport(withDigest('sha256:bbb'));
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(1);
  });

  test('an image another container still owns is not removed', async () => {
    const { preloader, host } = arrange({ preload: true, preloadmaxcandidates: 2 });
    await preloader.handleReport(withDigest('sha256:aaa'));
    await preloader.idle();
    host.isImageOnHost.mockResolvedValue(true);
    await preloader.handleReport(withDigest('sha256:aaa', { id: 'c2', name: 'api' }));
    await preloader.idle();

    await preloader.handleReport(withDigest('sha256:bbb'));
    await preloader.idle();
    expect(host.removeImage).not.toHaveBeenCalled();
    expect(countRetainedImagePreloads('local.local')).toBe(2);

    await preloader.handleReport(withDigest('sha256:bbb', { id: 'c2', name: 'api' }));
    await preloader.idle();
    expect(host.removeImage).toHaveBeenCalledTimes(1);
  });

  test('a tag that is a retained rollback backup is released but never removed', async () => {
    const { preloader, host } = arrange({ preload: true, preloadmaxcandidates: 1 });
    host.isRollbackTag.mockReturnValue(true);
    const first = makeContainer({ result: { tag: '1.1.0' } });
    await preloader.handleReport(first);
    await preloader.idle();
    host.getNewImageFullName.mockReturnValue('org/web:1.2.0');
    await preloader.handleReport(makeContainer({ result: { tag: '1.2.0' } }));
    await preloader.idle();
    expect(host.isRollbackTag).toHaveBeenCalledWith(expect.anything(), '1.1.0');
    expect(host.removeImage).not.toHaveBeenCalled();
    expect(host.pullImage).toHaveBeenCalledTimes(2);
    expect(countRetainedImagePreloads('local.local')).toBe(1);
  });

  test('a superseded tag that is not a rollback backup is removed', async () => {
    const { preloader, host } = arrange({ preload: true, preloadmaxcandidates: 1 });
    await preloader.handleReport(makeContainer({ result: { tag: '1.1.0' } }));
    await preloader.idle();
    host.getNewImageFullName.mockReturnValue('org/web:1.2.0');
    await preloader.handleReport(makeContainer({ result: { tag: '1.2.0' } }));
    await preloader.idle();
    expect(host.removeImage).toHaveBeenCalledWith(expect.anything(), 'org/web:1.1.0', host.log);
  });

  test('a withdrawn candidate removes its image', async () => {
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    await preloader.idle();
    expect(host.removeImage).toHaveBeenCalledWith(
      expect.anything(),
      'org/web@sha256:aaa',
      host.log,
    );
    expect(countRetainedImagePreloads('local.local')).toBe(0);
  });

  test('a withdrawn candidate whose removal failed is retried on the next report', async () => {
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    host.removeImage.mockRejectedValueOnce(new Error('daemon down'));
    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    await preloader.idle();
    expect(peekImagePreload(makeContainer())).toBeDefined();
    expect(countRetainedImagePreloads('local.local')).toBe(1);

    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    await preloader.idle();
    expect(host.removeImage).toHaveBeenCalledTimes(2);
    expect(peekImagePreload(makeContainer())).toBeUndefined();
    expect(countRetainedImagePreloads('local.local')).toBe(0);
  });

  test('a replacement waiting on cleanup holds the host concurrency slot', async () => {
    const { preloader, host } = arrange({ preload: true, preloadconcurrency: 1 });
    await preloader.handleReport(withDigest('sha256:aaa'));
    await preloader.idle();
    let finishRemoval: () => void = () => undefined;
    host.removeImage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishRemoval = resolve)),
    );
    const other = makeContainer({ name: 'other', id: 'other-id' });
    await preloader.handleReport(withDigest('sha256:bbb'));
    await preloader.handleReport(other);
    await Promise.resolve();
    finishRemoval();
    await preloader.idle();
    expect(host.pullImage).toHaveBeenCalledTimes(2);
  });

  test('cleanup of a container that never preloaded does nothing', async () => {
    const { preloader, host } = arrange();
    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    await preloader.idle();
    expect(host.removeImage).not.toHaveBeenCalled();
  });

  test('a cleanup that cannot reach the host is logged with its container', async () => {
    const { preloader, host, log } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    host.getWatcher.mockImplementation(() => {
      throw new Error('No watcher');
    });
    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    await preloader.idle();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('could not be removed'));
  });

  test('a failed pull gives the reference back', async () => {
    const { preloader, host } = arrange();
    host.pullImage.mockRejectedValueOnce(new Error('boom'));
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    expect(countRetainedImagePreloads('local.local')).toBe(0);
  });

  test('an unexpected cleanup failure is logged, not thrown', async () => {
    const { preloader, log } = arrange();
    await preloader.handleReport(makeContainer());
    await preloader.idle();
    vi.spyOn(
      preloader as unknown as { releaseImage: () => Promise<boolean> },
      'releaseImage',
    ).mockRejectedValueOnce(new Error('unexpected'));
    await preloader.handleReport(makeContainer({ result: { tag: '1.0.0' } }));
    await preloader.idle();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected'));
  });
});

describe('registry resolution failures', () => {
  test('an unresolvable registry records a failed preload and waits out the cool-down', async () => {
    vi.useFakeTimers();
    try {
      const { preloader, host, log } = arrange();
      host.resolveRegistryManager.mockImplementation(() => {
        throw new Error('unsupported registry');
      });
      const container = makeContainer();
      await preloader.handleReport(container);
      await preloader.idle();
      expect(getImagePreloadView(container)).toMatchObject({
        status: 'failed',
        error: 'unsupported registry',
      });
      expect(countRetainedImagePreloads('local.local')).toBe(0);
      expect(log.warn).toHaveBeenCalledTimes(1);

      await preloader.handleReport(container);
      await preloader.idle();
      expect(host.resolveRegistryManager).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(PRELOAD_RETRY_AFTER_MS + 1);
      host.resolveRegistryManager.mockReturnValue(makeHost().registry);
      await preloader.handleReport(container);
      await preloader.idle();
      expect(host.resolveRegistryManager).toHaveBeenCalledTimes(2);
      expect(getImagePreload(container)?.status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a recorded preload is rechecked against the host', () => {
  test('an image that cleanup removed is pulled again', async () => {
    const { preloader, host } = arrange();
    const container = makeContainer();
    await preloader.handleReport(container);
    await preloader.idle();
    host.isImageOnHost.mockResolvedValue(false);
    await preloader.handleReport(container);
    await preloader.idle();
    expect(host.isImageOnHost).toHaveBeenCalledTimes(2);
    expect(host.pullImage).toHaveBeenCalledTimes(2);
    expect(getImagePreload(container)?.status).toBe('done');
    expect(countRetainedImagePreloads('local.local')).toBe(1);
  });

  test('the status goes back to pending while the image is fetched again', async () => {
    const { preloader, host } = arrange();
    const container = makeContainer();
    await preloader.handleReport(container);
    await preloader.idle();
    let finish: () => void = () => undefined;
    host.pullImage.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await preloader.handleReport(container);
    await vi.waitFor(() => expect(getImagePreload(container)?.status).toBe('pending'));
    finish();
    await preloader.idle();
    expect(getImagePreload(container)?.status).toBe('done');
  });

  test('an image still on the host is inspected but not pulled', async () => {
    const { preloader, host } = arrange();
    const container = makeContainer({ result: { tag: '1.1.0' } });
    await preloader.handleReport(container);
    await preloader.idle();
    host.isImageOnHost.mockResolvedValue(true);
    await preloader.handleReport(container);
    await preloader.idle();
    expect(host.isImageOnHost).toHaveBeenCalledTimes(2);
    expect(host.pullImage).toHaveBeenCalledTimes(1);
    expect(getImagePreload(container)?.status).toBe('done');
  });

  test('a preload still in flight is not started twice', async () => {
    const { preloader, host } = arrange({ preload: true, preloadconcurrency: 2 });
    let finish: () => void = () => undefined;
    host.pullImage.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await preloader.handleReport(makeContainer());
    await vi.waitFor(() => expect(host.pullImage).toHaveBeenCalledTimes(1));
    await preloader.handleReport(makeContainer());
    await Promise.resolve();
    expect(host.isImageOnHost).toHaveBeenCalledTimes(1);
    finish();
    await preloader.idle();
  });
});

describe('update mode and projected candidates', () => {
  test('a notify ceiling never applies updates, so nothing is preloaded', () => {
    mocks.resolveUpdateModeCeiling.mockReturnValue({ value: 'notify', source: 'global' });
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer())).toEqual({
      preload: false,
      reason: 'update mode is notify, updates are never applied',
    });
    expect(mocks.resolveUpdateModeCeiling).toHaveBeenCalledWith(expect.anything(), 'auto');
  });

  test('a manual ceiling still preloads', () => {
    mocks.resolveUpdateModeCeiling.mockReturnValue({ value: 'manual', source: 'group' });
    const { preloader } = arrange();
    expect(preloader.evaluate(makeContainer()).preload).toBe(true);
  });

  test('the candidate a separate-update-types trigger would apply is the one preloaded', async () => {
    const { preloader, host } = arrange();
    const reported = makeContainer({ result: { tag: '2.0.0', digest: 'sha256:major' } });
    mocks.chooseApprovalCandidate.mockReturnValue(
      makeContainer({ result: { tag: '1.3.0', digest: 'sha256:minor' } }),
    );
    await preloader.handleReport(reported);
    await preloader.idle();
    expect(mocks.chooseApprovalCandidate).toHaveBeenCalledWith(reported, {});
    expect(host.pullImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org/web@sha256:minor',
      host.log,
    );
  });
});

describe('dd.update.preload label spellings', () => {
  test.each(['1', 'yes', 'on'])('%s is not a boolean label value', (value) => {
    const { preloader } = arrange({ preload: 'label' });
    expect(
      preloader.evaluate(makeContainer({ labels: { 'dd.update.preload': value } })).preload,
    ).toBe(false);
  });

  test.each(['0', 'no', 'off'])('%s does not opt a container out', (value) => {
    const { preloader } = arrange();
    expect(
      preloader.evaluate(makeContainer({ labels: { 'dd.update.preload': value } })).preload,
    ).toBe(true);
  });
});
