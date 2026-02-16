import { onBeforeUnmount, type Ref, ref, watch } from 'vue';

export type AutoFetchIntervalOption = {
  title: string;
  value: number;
};

export const LOG_AUTO_FETCH_INTERVALS: AutoFetchIntervalOption[] = [
  { title: 'Off', value: 0 },
  { title: '2s', value: 2 },
  { title: '5s', value: 5 },
  { title: '10s', value: 10 },
  { title: '30s', value: 30 },
];

function isNearBottom(element: HTMLElement): boolean {
  const thresholdPx = 16;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= thresholdPx;
}

export function useLogViewport() {
  const logPre = ref<HTMLElement | null>(null);
  const scrollBlocked = ref(false);

  const scrollToBottom = function scrollToBottom(): void {
    const element = logPre.value;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    scrollBlocked.value = false;
  };

  const handleLogScroll = function handleLogScroll(): void {
    const element = logPre.value;
    if (!element) {
      return;
    }
    scrollBlocked.value = !isNearBottom(element);
  };

  const resumeAutoScroll = function resumeAutoScroll(): void {
    scrollBlocked.value = false;
    scrollToBottom();
  };

  return {
    logPre,
    scrollBlocked,
    scrollToBottom,
    handleLogScroll,
    resumeAutoScroll,
  };
}

type UseAutoFetchLogsOptions = {
  intervalSeconds: Ref<number>;
  loading: Ref<boolean>;
  fetchLogs: () => Promise<void>;
};

export function useAutoFetchLogs(options: UseAutoFetchLogsOptions) {
  let autoFetchTimer: ReturnType<typeof setInterval> | undefined;

  const stopAutoFetch = function stopAutoFetch(): void {
    if (autoFetchTimer) {
      clearInterval(autoFetchTimer);
      autoFetchTimer = undefined;
    }
  };

  const startAutoFetch = function startAutoFetch(): void {
    stopAutoFetch();
    if (options.intervalSeconds.value <= 0) {
      return;
    }
    autoFetchTimer = globalThis.setInterval(() => {
      if (!options.loading.value) {
        void options.fetchLogs();
      }
    }, options.intervalSeconds.value * 1000);
  };

  watch(options.intervalSeconds, function restartAutoFetchOnIntervalChange() {
    startAutoFetch();
  });

  onBeforeUnmount(function stopAutoFetchOnUnmount() {
    stopAutoFetch();
  });

  return {
    startAutoFetch,
    stopAutoFetch,
  };
}
