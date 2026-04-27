import { nextTick } from 'vue';
import { _resetScanLifecycleStateForTests, useScanLifecycle } from '@/composables/useScanLifecycle';

function dispatchSseStarted(containerId: unknown) {
  globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-started', { detail: { containerId } }));
}

function dispatchSseCompleted(containerId: unknown) {
  globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-completed', { detail: { containerId } }));
}

describe('useScanLifecycle', () => {
  beforeEach(() => {
    _resetScanLifecycleStateForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- API surface ---

  it('returns the public API surface', () => {
    const api = useScanLifecycle();
    expect(typeof api.markScanStarted).toBe('function');
    expect(typeof api.markScanCompleted).toBe('function');
    expect(typeof api.isScanInFlight).toBe('function');
    expect(api.scansInFlight).toBeDefined();
    expect((api.scansInFlight as any).__v_isReadonly).toBe(true);
  });

  it('starts with an empty scansInFlight set', () => {
    const { scansInFlight } = useScanLifecycle();
    expect(scansInFlight.value.size).toBe(0);
  });

  // --- markScanStarted ---

  it('markScanStarted adds id and isScanInFlight returns true', () => {
    const { markScanStarted, isScanInFlight } = useScanLifecycle();
    markScanStarted('c1');
    expect(isScanInFlight('c1')).toBe(true);
  });

  it('markScanStarted with the same id twice does not duplicate (Set behavior)', () => {
    const { markScanStarted, scansInFlight } = useScanLifecycle();
    markScanStarted('c1');
    markScanStarted('c1');
    expect(scansInFlight.value.size).toBe(1);
  });

  it('markScanStarted(undefined) is a no-op', () => {
    const { markScanStarted, scansInFlight } = useScanLifecycle();
    markScanStarted(undefined);
    expect(scansInFlight.value.size).toBe(0);
  });

  it('markScanStarted("") is a no-op', () => {
    const { markScanStarted, scansInFlight } = useScanLifecycle();
    markScanStarted('');
    expect(scansInFlight.value.size).toBe(0);
  });

  // --- markScanCompleted ---

  it('markScanCompleted removes the id from the set', () => {
    const { markScanStarted, markScanCompleted, isScanInFlight } = useScanLifecycle();
    markScanStarted('c1');
    markScanCompleted('c1');
    expect(isScanInFlight('c1')).toBe(false);
  });

  it('markScanCompleted for an id not in the set is a no-op', () => {
    const { markScanCompleted, scansInFlight } = useScanLifecycle();
    expect(() => markScanCompleted('ghost')).not.toThrow();
    expect(scansInFlight.value.size).toBe(0);
  });

  it('markScanCompleted(undefined) is a no-op', () => {
    const { markScanCompleted, scansInFlight } = useScanLifecycle();
    expect(() => markScanCompleted(undefined)).not.toThrow();
    expect(scansInFlight.value.size).toBe(0);
  });

  // --- isScanInFlight ---

  it('isScanInFlight(undefined) returns false', () => {
    const { isScanInFlight } = useScanLifecycle();
    expect(isScanInFlight(undefined)).toBe(false);
  });

  it('isScanInFlight returns false for an id not in the set', () => {
    const { isScanInFlight } = useScanLifecycle();
    expect(isScanInFlight('missing')).toBe(false);
  });

  // --- 120s safety timeout ---

  it('120s timeout auto-clears the entry after markScanStarted', () => {
    const { markScanStarted, isScanInFlight } = useScanLifecycle();
    markScanStarted('c1');
    expect(isScanInFlight('c1')).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(isScanInFlight('c1')).toBe(false);
  });

  it('markScanCompleted clears the pending timeout so it does not fire later', () => {
    const { markScanStarted, markScanCompleted, isScanInFlight, scansInFlight } =
      useScanLifecycle();
    markScanStarted('c1');
    markScanCompleted('c1');
    // Advance past the timeout — should not throw or re-add the entry
    vi.advanceTimersByTime(120_000);
    expect(isScanInFlight('c1')).toBe(false);
    expect(scansInFlight.value.size).toBe(0);
  });

  it('calling markScanStarted twice resets the timeout window', () => {
    const { markScanStarted, isScanInFlight } = useScanLifecycle();
    markScanStarted('c1');
    vi.advanceTimersByTime(60_000); // halfway through original window
    markScanStarted('c1'); // resets the 120s window
    vi.advanceTimersByTime(119_000); // 119s into the new window — still in flight
    expect(isScanInFlight('c1')).toBe(true);
    vi.advanceTimersByTime(2_000); // now past 120s from second start
    expect(isScanInFlight('c1')).toBe(false);
  });

  // --- SSE global event listeners ---

  it('dd:sse-scan-started event marks the container in flight', async () => {
    const { isScanInFlight } = useScanLifecycle();
    dispatchSseStarted('c1');
    await nextTick();
    expect(isScanInFlight('c1')).toBe(true);
  });

  it('dd:sse-scan-completed event clears the container', async () => {
    const { isScanInFlight } = useScanLifecycle();
    dispatchSseStarted('c1');
    await nextTick();
    dispatchSseCompleted('c1');
    await nextTick();
    expect(isScanInFlight('c1')).toBe(false);
  });

  it('SSE event with missing containerId in detail is ignored', async () => {
    const { scansInFlight } = useScanLifecycle();
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-started', { detail: {} }));
    await nextTick();
    expect(scansInFlight.value.size).toBe(0);
  });

  it('SSE event with non-object detail is ignored', async () => {
    const { scansInFlight } = useScanLifecycle();
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-started', { detail: 'not-an-object' }));
    await nextTick();
    expect(scansInFlight.value.size).toBe(0);
  });

  it('SSE event with null detail is ignored', async () => {
    const { scansInFlight } = useScanLifecycle();
    globalThis.dispatchEvent(new CustomEvent('dd:sse-scan-started', { detail: null }));
    await nextTick();
    expect(scansInFlight.value.size).toBe(0);
  });

  it('SSE event with empty-string containerId is ignored', async () => {
    const { scansInFlight } = useScanLifecycle();
    dispatchSseStarted('');
    await nextTick();
    expect(scansInFlight.value.size).toBe(0);
  });

  // --- _resetScanLifecycleStateForTests ---

  it('_resetScanLifecycleStateForTests clears all entries and pending timeouts', () => {
    const { markScanStarted, scansInFlight } = useScanLifecycle();
    markScanStarted('c1');
    markScanStarted('c2');
    expect(scansInFlight.value.size).toBe(2);

    _resetScanLifecycleStateForTests();
    expect(scansInFlight.value.size).toBe(0);

    // Timeouts cleared: advancing time must not re-add anything
    vi.advanceTimersByTime(120_000);
    expect(scansInFlight.value.size).toBe(0);
  });

  // --- singleton state shared across composable calls ---

  it('multiple useScanLifecycle() calls share the same singleton ref', () => {
    const a = useScanLifecycle();
    const b = useScanLifecycle();
    a.markScanStarted('c1');
    expect(b.isScanInFlight('c1')).toBe(true);
    expect(a.scansInFlight).toBe(b.scansInFlight);
  });
});
