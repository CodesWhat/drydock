import { flushPromises } from '@vue/test-utils';

const api = vi.fn();
vi.mock('@/services/container', () => ({
  scanAllContainersApi: async (...args: unknown[]) => {
    const response = await api(...args);
    return response == null ? response : { ...response, requestId: args[1] };
  },
}));

const options = { scannerReady: true, runtimeLoading: false };
let progress: ReturnType<typeof import('@/composables/useScanProgress').useScanProgress>;
let stream: ReturnType<typeof import('@/stores/eventStream').useEventStreamStore>;
let scheduledTotal = 2;
const emitted = new Map<string, Set<string>>();

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  scheduledTotal = 2;
  emitted.clear();
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
  const completed = emitted.get(cycleId) ?? new Set<string>();
  completed.add(containerId);
  emitted.set(cycleId, completed);
  const payload = {
    containerId,
    cycleId,
    status: 'passed',
    requestId: cycleId === 'accepted' ? api.mock.calls[0]?.[1] : 'f'.repeat(32),
    completedCount: completed.size,
    scheduledCount: scheduledTotal,
  };
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

it.each(['accepted', 'unrelated'])(
  'does not exhaust early buffering with duplicate %s completions',
  async (cycleId) => {
    const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
    api.mockReturnValue(response.promise);
    const outcome = progress.scanAllContainers(options).catch((error) => error);
    for (let index = 0; index < 501; index++) complete('one', cycleId);
    complete('one');
    response.resolve({ cycleId: 'accepted', scheduledCount: 2 });
    await flushPromises();
    try {
      expect(progress.scanning.value).toBe(true);
      expect(progress.scanProgress.value).toEqual({ done: 1, total: 2 });
      complete('two');
      expect(await outcome).toBeUndefined();
      expect(progress.scanProgress.value).toEqual({ done: 2, total: 2 });
      expect(api).toHaveBeenCalledTimes(1);
    } finally {
      progress.cancelScan();
      await outcome;
    }
  },
);

it('keeps identical container IDs from different early cycles distinct', async () => {
  scheduledTotal = 1;
  const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  complete('one', 'unrelated');
  complete('one');
  response.resolve({ cycleId: 'accepted', scheduledCount: 1 });
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(false);
    expect(progress.scanProgress.value).toEqual({ done: 1, total: 1 });
    expect(await outcome).toBeUndefined();
  } finally {
    progress.cancelScan();
    await outcome;
  }
});

it('accepts duplicate cumulative progress replays for a large early cycle', async () => {
  scheduledTotal = 500;
  const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  for (let index = 0; index < 500; index++) complete(String(index));
  for (let index = 0; index < 500; index++) complete(String(index));
  response.resolve({ cycleId: 'accepted', scheduledCount: 500 });
  await flushPromises();
  try {
    expect(await outcome).toBeUndefined();
    expect(progress.scanning.value).toBe(false);
    expect(progress.scanProgress.value).toEqual({ done: 500, total: 500 });
  } finally {
    progress.cancelScan();
    await outcome;
  }
});

it('tracks more than 500 early completions without a per-container buffer', async () => {
  scheduledTotal = 501;
  const response = Promise.withResolvers<{ cycleId: string; scheduledCount: number }>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  for (let index = 0; index < 501; index++) complete(String(index));
  response.resolve({ cycleId: 'accepted', scheduledCount: 501 });
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeUndefined();
    expect(progress.scanProgress.value).toEqual({ done: 501, total: 501 });
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
