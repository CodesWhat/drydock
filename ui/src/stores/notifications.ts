import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { i18n } from '@/boot/i18n';
import { useStorageRef } from '@/composables/useStorageRef';
import { getAuditLog } from '@/services/audit';
import {
  getAllNotificationRules,
  type NotificationBellThreshold,
  type NotificationRule,
} from '@/services/notification';
import type { AuditEntry } from '@/utils/audit-helpers';
import { type SseBusEvent, useEventStreamStore } from './eventStream';

export const BELL_ACTIONS = [
  'update-available',
  'update-applied',
  'update-failed',
  'notification-delivery-failed',
  'security-alert',
  'agent-disconnect',
  'container-unhealthy',
];

const ALWAYS_BELL_ACTIONS = ['notification-delivery-failed'];
const BELL_ENTRY_LIMIT = 20;
const BELL_BACKFILL_MAX_PAGES = 10;

export function isBellRuleSupported(ruleId: string): boolean {
  return BELL_ACTIONS.includes(ruleId) && !ALWAYS_BELL_ACTIONS.includes(ruleId);
}

function updateMeetsBellThreshold(
  semverDiff: AuditEntry['semverDiff'],
  threshold: NotificationBellThreshold,
  updateKind: AuditEntry['updateKind'],
): boolean {
  if (threshold === 'all') return true;
  if (updateKind === 'digest') return true;
  if (threshold === 'major') return semverDiff === 'major';
  if (threshold === 'minor') return semverDiff === 'major' || semverDiff === 'minor';
  return semverDiff === 'major' || semverDiff === 'minor' || semverDiff === 'patch';
}

function bellActionsForRules(rules: NotificationRule[]): string[] {
  const enabledActions = new Set(rules.filter((rule) => rule.bellEnabled).map((rule) => rule.id));
  return BELL_ACTIONS.filter(
    (action) => ALWAYS_BELL_ACTIONS.includes(action) || enabledActions.has(action),
  );
}

const BELL_REFRESH_EVENTS: SseBusEvent[] = [
  'container-changed',
  'container-unhealthy',
  'scan-completed',
  'sse:connected',
  'resync-required',
  'update-operation-changed',
  'update-applied',
  'update-failed',
  'agent-status-changed',
];

export const useNotificationStore = defineStore('notifications', () => {
  const t = i18n.global.t;
  const entries = ref<AuditEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastSeen = useStorageRef('dd-bell-last-seen', '');
  const dismissedIds = useStorageRef<string[]>(
    'dd-bell-dismissed-ids',
    [],
    (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  );

  let sseDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeEventStream: Array<() => void> = [];
  let fetchSequence = 0;

  const visibleEntries = computed(() => {
    const dismissed = new Set(dismissedIds.value);
    return entries.value.filter((entry) => !dismissed.has(entry.id));
  });

  const unreadCount = computed(() => {
    if (!lastSeen.value) {
      return visibleEntries.value.length;
    }
    return visibleEntries.value.filter((entry) => entry.timestamp > lastSeen.value).length;
  });

  function normalizeFetchError(caught: unknown): string {
    if (caught instanceof Error && caught.message) {
      return caught.message;
    }
    if (typeof caught === 'string' && caught !== '') {
      return caught;
    }
    return t('sharedComponents.notifications.loadFailed');
  }

  async function fetchEntries(): Promise<void> {
    const requestSequence = ++fetchSequence;
    loading.value = true;
    try {
      const rules = await getAllNotificationRules().catch(() => null);
      const actions = rules ? bellActionsForRules(rules) : BELL_ACTIONS;
      const updateAvailableRule = rules?.find((rule) => rule.id === 'update-available');
      const matchingEntries: AuditEntry[] = [];
      let offset = 0;

      for (
        let page = 0;
        page < BELL_BACKFILL_MAX_PAGES && matchingEntries.length < BELL_ENTRY_LIMIT;
        page += 1
      ) {
        const data = await getAuditLog({
          limit: BELL_ENTRY_LIMIT,
          ...(offset > 0 ? { offset } : {}),
          actions,
        });
        if (requestSequence !== fetchSequence) {
          return;
        }
        const pageEntries: AuditEntry[] = data.entries ?? [];
        matchingEntries.push(
          ...pageEntries.filter(
            (entry) =>
              entry.action !== 'update-available' ||
              !updateAvailableRule ||
              updateMeetsBellThreshold(
                entry.semverDiff,
                updateAvailableRule.bellThreshold,
                entry.updateKind,
              ),
          ),
        );
        if (data.hasMore !== true || pageEntries.length === 0) {
          break;
        }
        offset += pageEntries.length;
      }

      entries.value = matchingEntries.slice(0, BELL_ENTRY_LIMIT);
      error.value = null;
    } catch (caught) {
      if (requestSequence === fetchSequence) {
        error.value = normalizeFetchError(caught);
      }
    } finally {
      if (requestSequence === fetchSequence) {
        loading.value = false;
      }
    }
  }

  function scheduleFetch(): void {
    clearTimeout(sseDebounceTimer);
    sseDebounceTimer = setTimeout(() => {
      void fetchEntries();
    }, 800);
  }

  function markSeenNow(): void {
    lastSeen.value = new Date().toISOString();
  }

  function dismissOne(entry: AuditEntry): void {
    if (dismissedIds.value.includes(entry.id)) {
      return;
    }
    dismissedIds.value = [...dismissedIds.value, entry.id];
  }

  function dismissAll(): void {
    if (visibleEntries.value.length === 0) {
      return;
    }
    const existing = new Set(dismissedIds.value);
    const toAdd = visibleEntries.value.map((entry) => entry.id).filter((id) => !existing.has(id));
    dismissedIds.value = [...dismissedIds.value, ...toAdd];
  }

  function start(): void {
    if (unsubscribeEventStream.length > 0) {
      return;
    }
    void fetchEntries();
    const eventStream = useEventStreamStore();
    unsubscribeEventStream = BELL_REFRESH_EVENTS.map((event) =>
      eventStream.subscribe(event, scheduleFetch),
    );
  }

  function stop(): void {
    clearTimeout(sseDebounceTimer);
    sseDebounceTimer = undefined;
    for (const unsubscribe of unsubscribeEventStream) {
      unsubscribe();
    }
    unsubscribeEventStream = [];
  }

  return {
    entries,
    loading,
    error,
    lastSeen,
    dismissedIds,
    visibleEntries,
    unreadCount,
    fetchEntries,
    scheduleFetch,
    markSeenNow,
    dismissOne,
    dismissAll,
    start,
    stop,
  };
});
