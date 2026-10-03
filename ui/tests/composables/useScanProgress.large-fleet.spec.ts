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
});

function requestId(): string {
  return api.mock.calls[0]?.[1] ?? 'a'.repeat(32);
}

function completed(done: number, total: number, overrides: Record<string, unknown> = {}) {
  stream.publish('scan-completed', {
    containerId: `container-${done}`,
    cycleId: 'accepted',
    requestId: requestId(),
    completedCount: done,
    scheduledCount: total,
    status: 'passed',
    ...overrides,
  });
}

it('tracks a large accepted cycle despite unrelated early traffic and delayed acceptance', async () => {
  const response = Promise.withResolvers<unknown>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  for (let done = 1; done <= 1200; done++) {
    completed(1, 1, { requestId: 'b'.repeat(32), cycleId: `other-${done}` });
    completed(done, 1200);
    completed(done, 1200);
  }
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(true);
    expect(api.mock.calls[0][1]).toMatch(/^[a-f0-9]{32}$/);
    response.resolve({ cycleId: 'accepted', requestId: requestId(), scheduledCount: 1200 });
    await flushPromises();
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeUndefined();
    expect(progress.scanProgress.value).toEqual({ done: 1200, total: 1200 });
    expect(api).toHaveBeenCalledTimes(1);
  } finally {
    progress.cancelScan();
    response.resolve({ cycleId: 'accepted', requestId: requestId(), scheduledCount: 1200 });
    await outcome;
  }
});

it('uses monotonic server counts without counting replayed or out-of-order events again', async () => {
  api.mockImplementation((_signal, correlation) =>
    Promise.resolve({ cycleId: 'accepted', requestId: correlation, scheduledCount: 1000 }),
  );
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  await flushPromises();
  completed(700, 1000);
  completed(699, 1000);
  completed(700, 1000);
  completed(1000, 1000, { requestId: 'b'.repeat(32) });
  try {
    expect(progress.scanProgress.value).toEqual({ done: 700, total: 1000 });
    completed(1000, 1000);
    await flushPromises();
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeUndefined();
    expect(progress.scanProgress.value).toEqual({ done: 1000, total: 1000 });
  } finally {
    progress.cancelScan();
    await outcome;
  }
});

it.each([
  { completedCount: -1 },
  { completedCount: 1.5 },
  { completedCount: 3 },
  { completedCount: undefined },
  { completedCount: Number.MAX_SAFE_INTEGER + 1 },
  { scheduledCount: 3 },
  { scheduledCount: -1 },
  { scheduledCount: 1.5 },
  { scheduledCount: undefined },
  { cycleId: 'conflicting' },
  { cycleId: '' },
  { cycleId: undefined },
])('reports unavailable progress for conflicting own-request metadata %j', async (invalid) => {
  api.mockImplementation((_signal, correlation) =>
    Promise.resolve({ cycleId: 'accepted', requestId: correlation, scheduledCount: 2 }),
  );
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  await flushPromises();
  completed(1, 2, invalid);
  await flushPromises();
  try {
    expect(progress.scanning.value).toBe(false);
    expect(await outcome).toBeInstanceOf(Error);
    expect(api).toHaveBeenCalledTimes(1);
  } finally {
    progress.cancelScan();
    await outcome;
  }
});

it.each([
  { cycleId: 'different' },
  { scheduledCount: 3 },
  { requestId: 'different' },
  { requestId: undefined },
])('rejects acceptance inconsistent with early progress %j', async (invalid) => {
  const response = Promise.withResolvers<unknown>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options).catch((error) => error);
  completed(1, 2);
  response.resolve({ cycleId: 'accepted', requestId: requestId(), scheduledCount: 2, ...invalid });
  expect(await outcome).toBeInstanceOf(Error);
  expect(progress.scanning.value).toBe(false);
});

it.each([{ cycleId: 'different' }, { scheduledCount: 3 }])(
  'rejects conflicting own-request events before acceptance %j',
  async (invalid) => {
    const response = Promise.withResolvers<unknown>();
    api.mockReturnValue(response.promise);
    const outcome = progress.scanAllContainers(options).catch((error) => error);
    completed(1, 2);
    completed(2, 2, invalid);
    completed(2, 2);
    expect(await outcome).toBeInstanceOf(Error);
    response.resolve({ cycleId: 'accepted', requestId: requestId(), scheduledCount: 2 });
    expect(progress.scanProgress.value.done).toBe(0);
  },
);

it('cleans up cancellation during large early traffic without processing late acceptance', async () => {
  const response = Promise.withResolvers<unknown>();
  api.mockReturnValue(response.promise);
  const outcome = progress.scanAllContainers(options);
  for (let done = 1; done <= 800; done++) completed(done, 1200);
  const correlation = requestId();
  progress.cancelScan();
  completed(1200, 1200);
  await outcome;
  response.resolve({ cycleId: 'accepted', requestId: correlation, scheduledCount: 1200 });
  await flushPromises();
  expect(progress.scanning.value).toBe(false);
  expect(progress.scanProgress.value).toEqual({ done: 0, total: 0 });
  expect(api.mock.calls[0][0].aborted).toBe(true);
});
