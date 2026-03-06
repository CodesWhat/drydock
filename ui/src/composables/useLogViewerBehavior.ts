import { onScopeDispose, type Ref, ref, watch } from 'vue';

export function useLogViewport() {
  const logContainer = ref<HTMLElement | null>(null);
  const scrollBlocked = ref(false);

  function scrollToBottom() {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  }

  function handleLogScroll() {
    if (!logContainer.value) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainer.value;
    const atBottom = scrollHeight - scrollTop - clientHeight < 30;
    scrollBlocked.value = !atBottom;
  }

  function resumeAutoScroll() {
    scrollBlocked.value = false;
    scrollToBottom();
  }

  return { logContainer, scrollBlocked, scrollToBottom, handleLogScroll, resumeAutoScroll };
}

export interface LogAutoFetchIntervalOption {
  label: string;
  value: number;
}

export const LOG_AUTO_FETCH_INTERVALS: LogAutoFetchIntervalOption[] = [
  { label: 'Off', value: 0 },
  { label: '2s', value: 2000 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
];

interface AutoFetchOptions {
  fetchFn: () => Promise<void>;
  scrollToBottom: () => void;
  scrollBlocked: Ref<boolean>;
}

export function useAutoFetchLogs(options: AutoFetchOptions) {
  const autoFetchInterval = ref(0);
  let timerId: ReturnType<typeof setInterval> | undefined;

  function isTabHidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  function startAutoFetch() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(async () => {
      await options.fetchFn();
      if (!options.scrollBlocked.value) options.scrollToBottom();
    }, autoFetchInterval.value);
  }

  function stopAutoFetch() {
    if (timerId) {
      clearInterval(timerId);
      timerId = undefined;
    }
  }

  watch(autoFetchInterval, (val) => {
    if (val > 0 && !isTabHidden()) startAutoFetch();
    else stopAutoFetch();
  });

  if (typeof document !== 'undefined') {
    const handleVisibilityChange = () => {
      if (isTabHidden()) stopAutoFetch();
      else if (autoFetchInterval.value > 0) startAutoFetch();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    onScopeDispose(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
  }

  onScopeDispose(() => stopAutoFetch());

  return { autoFetchInterval };
}
