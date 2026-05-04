import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventStreamStore } from '@/stores/eventStream';
import { BELL_ACTIONS, useNotificationStore } from '@/stores/notifications';

const mockGetAuditLog = vi.fn();

vi.mock('@/services/audit', () => ({
  getAuditLog: (...args: unknown[]) => mockGetAuditLog(...args),
}));

const entries = [
  {
    id: '1',
    timestamp: '2026-04-29T12:00:00.000Z',
    action: 'update-applied',
    containerName: 'web',
    status: 'success' as const,
  },
  {
    id: '2',
    timestamp: '2026-04-29T12:01:00.000Z',
    action: 'update-failed',
    containerName: 'api',
    status: 'error' as const,
  },
];

describe('useNotificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    mockGetAuditLog.mockReset().mockResolvedValue({ entries });
  });

  it('fetches bell entries with the actionable action filter', async () => {
    const store = useNotificationStore();

    await store.fetchEntries();

    expect(mockGetAuditLog).toHaveBeenCalledWith({ limit: 20, actions: BELL_ACTIONS });
    expect(store.visibleEntries).toHaveLength(2);
    expect(store.unreadCount).toBe(2);
    expect(store.error).toBeNull();
  });

  it('preserves the last known entries when a refresh fails', async () => {
    const store = useNotificationStore();
    await store.fetchEntries();

    mockGetAuditLog.mockRejectedValueOnce(new Error('network unavailable'));
    await store.fetchEntries();

    expect(store.visibleEntries).toHaveLength(2);
    expect(store.unreadCount).toBe(2);
    expect(store.error).toBe('network unavailable');
    expect(store.loading).toBe(false);
  });

  it('records string refresh failures without clearing entries', async () => {
    const store = useNotificationStore();
    await store.fetchEntries();

    mockGetAuditLog.mockRejectedValueOnce('offline');
    await store.fetchEntries();

    expect(store.visibleEntries).toHaveLength(2);
    expect(store.error).toBe('offline');
  });

  it('uses a generic refresh error for empty or unknown failures', async () => {
    const store = useNotificationStore();
    await store.fetchEntries();

    mockGetAuditLog.mockRejectedValueOnce('');
    await store.fetchEntries();
    expect(store.error).toBe('Failed to load notifications');

    mockGetAuditLog.mockRejectedValueOnce({});
    await store.fetchEntries();
    expect(store.error).toBe('Failed to load notifications');
    expect(store.visibleEntries).toHaveLength(2);
  });

  it('dismisses individual and visible entries without duplicating ids', async () => {
    const store = useNotificationStore();
    await store.fetchEntries();

    store.dismissOne(entries[0]);
    store.dismissOne(entries[0]);
    expect(store.visibleEntries.map((entry) => entry.id)).toEqual(['2']);

    store.dismissAll();
    store.dismissAll();
    expect(store.visibleEntries).toEqual([]);
    expect(store.dismissedIds).toEqual(['1', '2']);
  });

  it('treats empty visible sets and already-dismissed visible sets as no-ops', async () => {
    const store = useNotificationStore();
    mockGetAuditLog.mockResolvedValueOnce({ entries: [] });
    await store.fetchEntries();

    store.dismissAll();
    expect(store.dismissedIds).toEqual([]);

    mockGetAuditLog.mockResolvedValueOnce({ entries: [entries[0]] });
    await store.fetchEntries();
    store.dismissOne(entries[0]);
    store.dismissAll();
    expect(store.dismissedIds).toEqual(['1']);
  });

  it('subscribes to event stream refresh events once and cancels on stop', async () => {
    vi.useFakeTimers();
    try {
      const store = useNotificationStore();
      const eventStream = useEventStreamStore();

      store.start();
      store.start();
      await Promise.resolve();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(1);

      eventStream.publish('update-failed');
      eventStream.publish('container-changed');
      vi.advanceTimersByTime(799);
      await Promise.resolve();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(2);

      store.stop();
      eventStream.publish('update-applied');
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      expect(mockGetAuditLog).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
