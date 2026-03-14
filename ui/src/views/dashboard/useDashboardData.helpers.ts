import type { ComputedRef, Ref } from 'vue';

export type RealtimeRefreshMode = 'summary' | 'full';

interface RealtimeRefreshSchedulerOptions {
  debounceMs: number;
  refreshSummary: () => void;
  refreshFull: () => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface MaintenanceCountdownControllerOptions {
  hasMaintenanceWindows: ComputedRef<boolean>;
  maintenanceCountdownNow: Ref<number>;
  isPageVisible: () => boolean;
  nowFn?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

function selectRealtimeRefreshMode(
  current: RealtimeRefreshMode | undefined,
  requested: RealtimeRefreshMode,
): RealtimeRefreshMode {
  if (current === 'full' || requested === 'full') {
    return 'full';
  }
  return 'summary';
}

export function createRealtimeRefreshScheduler({
  debounceMs,
  refreshSummary,
  refreshFull,
  setTimeoutFn = globalThis.setTimeout.bind(globalThis),
  clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
}: RealtimeRefreshSchedulerOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduledMode: RealtimeRefreshMode | undefined;

  function schedule(mode: RealtimeRefreshMode) {
    scheduledMode = selectRealtimeRefreshMode(scheduledMode, mode);
    if (timer !== undefined) {
      clearTimeoutFn(timer);
    }
    timer = setTimeoutFn(() => {
      timer = undefined;
      const modeToRefresh = scheduledMode;
      scheduledMode = undefined;
      if (modeToRefresh === 'full') {
        refreshFull();
        return;
      }
      refreshSummary();
    }, debounceMs);
  }

  function dispose() {
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      timer = undefined;
    }
    scheduledMode = undefined;
  }

  return {
    schedule,
    dispose,
  };
}

export function createMaintenanceCountdownController({
  hasMaintenanceWindows,
  maintenanceCountdownNow,
  isPageVisible,
  nowFn = Date.now,
  setIntervalFn = globalThis.setInterval.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval.bind(globalThis),
}: MaintenanceCountdownControllerOptions) {
  let timer: ReturnType<typeof setInterval> | undefined;

  function stop() {
    if (timer !== undefined) {
      clearIntervalFn(timer);
      timer = undefined;
    }
  }

  function sync() {
    const shouldRunTimer = hasMaintenanceWindows.value && isPageVisible();
    if (!shouldRunTimer) {
      stop();
      return;
    }
    maintenanceCountdownNow.value = nowFn();
    if (timer !== undefined) {
      return;
    }
    timer = setIntervalFn(() => {
      maintenanceCountdownNow.value = nowFn();
    }, 30_000);
  }

  function dispose() {
    stop();
  }

  return {
    sync,
    dispose,
  };
}
