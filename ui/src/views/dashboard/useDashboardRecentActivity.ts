import { onScopeDispose, type Ref, ref, watch } from 'vue';
import { i18n } from '../../boot/i18n';
import { getAuditLog } from '../../services/audit';
import type { AuditEntry } from '../../utils/audit-helpers';
import { errorMessage } from '../../utils/error';
import { createRealtimeRefreshScheduler } from './useDashboardData.helpers';

export const DASHBOARD_ACTIVITY_LIMIT = 10;
const DASHBOARD_ACTIVITY_DEBOUNCE_MS = 1_000;
// The audit log has no SSE channel of its own, so besides the container and
// update events below the widget re-reads on a slow interval.
const DASHBOARD_ACTIVITY_POLL_INTERVAL_MS = 60_000;

const ACTIVITY_REFRESH_EVENTS = [
  'dd:sse-update-applied',
  'dd:sse-update-failed',
  'dd:sse-batch-update-completed',
  'dd:sse-container-added',
  'dd:sse-container-removed',
  'dd:sse-connected',
  'dd:sse-resync-required',
] as const;

function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Latest audit entries for the opt-in Recent Activity widget. Fetches only
 * while `enabled` is true, so a hidden widget costs no requests.
 */
export function useDashboardRecentActivity(options: { enabled: Ref<boolean> }) {
  const entries = ref<AuditEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let requestId = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let listening = false;

  async function refresh() {
    const current = ++requestId;
    loading.value = entries.value.length === 0;
    try {
      const data = await getAuditLog({ limit: DASHBOARD_ACTIVITY_LIMIT });
      if (current !== requestId) return;
      entries.value = Array.isArray(data?.entries)
        ? (data.entries as AuditEntry[]).slice(0, DASHBOARD_ACTIVITY_LIMIT)
        : [];
      error.value = null;
    } catch (e: unknown) {
      if (current !== requestId) return;
      error.value = errorMessage(e, i18n.global.t('dashboardView.recentActivity.loadFailed'));
    } finally {
      if (current === requestId) loading.value = false;
    }
  }

  const scheduler = createRealtimeRefreshScheduler({
    debounceMs: DASHBOARD_ACTIVITY_DEBOUNCE_MS,
    refreshFull: () => {
      void refresh();
    },
  });

  const listener = (() => {
    if (isPageVisible()) scheduler.schedule('full');
  }) as EventListener;

  // The watch below only fires on a change, so start() and stop() alternate.
  function start() {
    listening = true;
    for (const name of ACTIVITY_REFRESH_EVENTS) {
      globalThis.addEventListener(name, listener);
    }
    pollTimer = setInterval(() => {
      if (isPageVisible()) void refresh();
    }, DASHBOARD_ACTIVITY_POLL_INTERVAL_MS);
    void refresh();
  }

  function stop() {
    if (!listening) return;
    listening = false;
    for (const name of ACTIVITY_REFRESH_EVENTS) {
      globalThis.removeEventListener(name, listener);
    }
    clearInterval(pollTimer);
    pollTimer = undefined;
    scheduler.dispose();
    requestId += 1;
  }

  watch(
    options.enabled,
    (enabled) => {
      if (enabled) start();
      else stop();
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  return { entries, error, loading, refresh };
}
