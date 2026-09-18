import { flushPromises } from '@vue/test-utils';

const api = vi.fn();
vi.mock('@/services/container', () => ({
  scanAllContainersApi: (...args: unknown[]) => api(...args),
}));

const options = { scannerReady: true, runtimeLoading: false };
let progress: ReturnType<typeof import('@/composables/useScanProgress').useScanProgress>;
let stream: ReturnType<typeof import('@/stores/eventStream').useEventStreamStore>;

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  const { createPinia, setActivePinia } = await import('pinia');
  setActivePinia(createPinia());
  stream = (await import('@/stores/eventStream')).useEventStreamStore();
  stream.status = 'open';
  progress = (await import('@/composables/useScanProgress')).useScanProgress();
});

afterEach(async () => {
  progress.cancelScan();
  await flushPromises();
  stream.$dispose();
  vi.useRealTimers();
});

function complete(containerId: string, cycleId = 'accepted') {
  const payload = { containerId, cycleId, status: 'passed' };
  stream.publish('scan-completed', payload);
  // Existing AppLayout bridge. Old and new consumers see the same event.
  globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed', { detail: payload }));
}

it('ignores unrelated cycles, missing identity and duplicate completions', async () => {
  api.mockResolvedValue({ cycleId: 'accepted', scheduledCount: 2 });
  const run = progress.scanAllContainers(options);
  await flushPromises();
  complete('other', 'unrelated');
  stream.publish('scan-completed', {});
  stream.publish('scan-completed', null);
  stream.publish('scan-completed', 'invalid');
  stream.publish('scan-completed', { containerId: ' ', cycleId: 'accepted' });
  stream.publish('scan-completed', { containerId: 'one', cycleId: ' ' });
  complete('one');
  complete('one');
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(true);
    expect(progress.scanProgress.value).toEqual({ done: 1, total: 2 });
    complete('two');
    complete('extra');
    await run;
    expect(progress.scanProgress.value).toEqual({ done: 2, total: 2 });
  } finally {
    progress.cancelScan();
    await run;
  }
});

it('retains matching completions received before the POST response', async () => {
  const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
  api.mockReturnValue(response.promise);
  const run = progress.scanAllContainers(options);
  complete('other', 'unrelated');
  complete('one');
  complete('one');
  complete('two');
  response.resolve({ cycleId: 'accepted', scheduledCount: 2 });
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(false);
    expect(progress.scanProgress.value).toEqual({ done: 2, total: 2 });
  } finally {
    progress.cancelScan();
    await run;
  }
});

it.each(['closed', 'connecting', 'error'] as const)(
  'does not send a write without a live stream (%s)',
  async (status) => {
    stream.status = status;
    api.mockResolvedValue({ cycleId: 'accepted', scheduledCount: 0 });
    const outcome = await progress.scanAllContainers(options).catch((error) => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(api).not.toHaveBeenCalled();
  },
);

it.each(['disconnect', 'resync'] as const)(
  'stops tracking honestly on %s and cleans subscriptions',
  async (cause) => {
    api.mockResolvedValue({ cycleId: 'accepted', scheduledCount: 2 });
    const outcome = progress.scanAllContainers(options).catch((error) => error);
    await flushPromises();
    complete('one');
    if (cause === 'disconnect') {
      stream.status = 'error';
      stream.status = 'open';
    } else stream.publish('resync-required', { reason: 'buffer-evicted' });
    await flushPromises();
    try {
      expect(progress.scanning.value).toBe(false);
      expect(await outcome).toBeInstanceOf(Error);
      complete('two');
      expect(progress.scanProgress.value.done).toBe(1);
    } finally {
      progress.cancelScan();
      await outcome;
    }
  },
);

it('bounds pre-response buffering instead of losing early events silently', async () => {
  const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  for (let index = 0; index < 501; index++) complete(String(index));
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeInstanceOf(Error);
    expect(api.mock.calls[0][0].aborted).toBe(true);
  } finally {
    progress.cancelScan();
    response.resolve({ cycleId: 'accepted', scheduledCount: 0 });
    await outcome;
  }
});

it('times out a missing acceptance response without automatically repeating the write', async () => {
  vi.useFakeTimers();
  const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  await vi.advanceTimersByTimeAsync(30_000);
  try {
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeInstanceOf(Error);
    expect(api).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    progress.cancelScan();
    response.resolve({ cycleId: 'accepted', scheduledCount: 0 });
    await outcome;
  }
});

it.each([
  null,
  {},
  { cycleId: '', scheduledCount: 1 },
  { cycleId: 'accepted', scheduledCount: -1 },
  { cycleId: 'accepted', scheduledCount: 1.5 },
])('rejects unusable acceptance data %j', async (response) => {
  api.mockResolvedValue(response);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeInstanceOf(Error);
  } finally {
    progress.cancelScan();
    await outcome;
  }
});
