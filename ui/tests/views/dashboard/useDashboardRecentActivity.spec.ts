import { flushPromises } from '@vue/test-utils';
import { effectScope, nextTick, ref } from 'vue';
import {
  DASHBOARD_ACTIVITY_LIMIT,
  useDashboardRecentActivity,
} from '@/views/dashboard/useDashboardRecentActivity';

const mocks = vi.hoisted(() => ({ getAuditLog: vi.fn() }));

vi.mock('@/services/audit', () => ({ getAuditLog: mocks.getAuditLog }));

function entry(id: string) {
  return {
    id,
    timestamp: '2026-10-22T10:00:00.000Z',
    action: 'update-applied',
    containerName: `container-${id}`,
    status: 'success',
  };
}

function setup(enabled = true) {
  const flag = ref(enabled);
  const scope = effectScope();
  const state = scope.run(() => useDashboardRecentActivity({ enabled: flag }))!;
  return { flag, scope, state };
}

describe('useDashboardRecentActivity', () => {
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    mocks.getAuditLog.mockResolvedValue({ entries: [entry('1'), entry('2')] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch while the widget is hidden', async () => {
    const { scope } = setup(false);
    await flushPromises();

    expect(mocks.getAuditLog).not.toHaveBeenCalled();
    scope.stop();
  });

  it('fetches the latest audit entries once enabled and stops when disabled', async () => {
    const { flag, scope, state } = setup(false);

    flag.value = true;
    await nextTick();
    await flushPromises();

    expect(mocks.getAuditLog).toHaveBeenCalledWith({ limit: DASHBOARD_ACTIVITY_LIMIT });
    expect(state.entries.value.map((e) => e.id)).toEqual(['1', '2']);
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();

    flag.value = false;
    await nextTick();
    mocks.getAuditLog.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.getAuditLog).not.toHaveBeenCalled();
    scope.stop();
  });

  it('caps the entries and tolerates a malformed payload', async () => {
    mocks.getAuditLog.mockResolvedValueOnce({
      entries: Array.from({ length: 25 }, (_, i) => entry(String(i))),
    });
    const { scope, state } = setup();
    await flushPromises();
    expect(state.entries.value).toHaveLength(DASHBOARD_ACTIVITY_LIMIT);

    mocks.getAuditLog.mockResolvedValueOnce(null);
    await state.refresh();
    expect(state.entries.value).toEqual([]);
    scope.stop();
  });

  it('keeps previous entries and reports an error when a refresh fails', async () => {
    const { scope, state } = setup();
    await flushPromises();

    mocks.getAuditLog.mockRejectedValueOnce(new Error('boom'));
    await state.refresh();

    expect(state.error.value).toBe('boom');
    expect(state.entries.value).toHaveLength(2);
    expect(state.loading.value).toBe(false);

    mocks.getAuditLog.mockResolvedValueOnce({ entries: [entry('3')] });
    await state.refresh();
    expect(state.error.value).toBeNull();
    scope.stop();
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mocks.getAuditLog.mockReset();
    mocks.getAuditLog.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const { scope, state } = setup();

    mocks.getAuditLog.mockResolvedValueOnce({ entries: [entry('new')] });
    await state.refresh();
    resolveFirst({ entries: [entry('stale')] });
    await flushPromises();
    expect(state.entries.value.map((e) => e.id)).toEqual(['new']);

    let rejectStale: (reason: unknown) => void = () => undefined;
    mocks.getAuditLog.mockImplementationOnce(
      () => new Promise((_, reject) => (rejectStale = reject)),
    );
    const pending = state.refresh();
    mocks.getAuditLog.mockResolvedValueOnce({ entries: [entry('newer')] });
    await state.refresh();
    rejectStale(new Error('late'));
    await pending;
    expect(state.error.value).toBeNull();
    expect(state.entries.value.map((e) => e.id)).toEqual(['newer']);
    scope.stop();
  });

  it('refreshes on SSE events (debounced) and on the poll interval while visible', async () => {
    const { scope } = setup();
    await flushPromises();
    mocks.getAuditLog.mockClear();

    globalThis.dispatchEvent(new Event('dd:sse-update-applied'));
    globalThis.dispatchEvent(new Event('dd:sse-container-added'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.getAuditLog).toHaveBeenCalledTimes(1);

    mocks.getAuditLog.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.getAuditLog).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('skips event and interval refreshes while the tab is hidden', async () => {
    const { scope } = setup();
    await flushPromises();
    mocks.getAuditLog.mockClear();

    visibility = 'hidden';
    globalThis.dispatchEvent(new Event('dd:sse-connected'));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(mocks.getAuditLog).not.toHaveBeenCalled();
    scope.stop();
  });

  it('removes listeners and timers when the scope is disposed', async () => {
    const { scope } = setup();
    await flushPromises();
    scope.stop();
    mocks.getAuditLog.mockClear();

    globalThis.dispatchEvent(new Event('dd:sse-resync-required'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.getAuditLog).not.toHaveBeenCalled();
  });

  it('does not double-register when enabled is re-asserted', async () => {
    const { flag, scope } = setup();
    await flushPromises();
    mocks.getAuditLog.mockClear();

    flag.value = false;
    flag.value = true;
    await nextTick();
    await flushPromises();
    mocks.getAuditLog.mockClear();
    globalThis.dispatchEvent(new Event('dd:sse-update-failed'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.getAuditLog).toHaveBeenCalledTimes(1);
    scope.stop();
  });
});
