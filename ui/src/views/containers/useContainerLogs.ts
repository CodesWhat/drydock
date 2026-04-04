import { type Ref, ref, watch } from 'vue';
import { useAutoFetchLogs, useLogViewport } from '../../composables/useLogViewerBehavior';
import { getContainerLogs as fetchContainerLogs } from '../../services/container';
import type { Container } from '../../types/container';

interface UseContainerLogsInput {
  activeDetailTab: Readonly<Ref<string>>;
  containerIdMap: Readonly<Ref<Record<string, string>>>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
}

type LogTarget = string | Pick<Container, 'id' | 'name'>;

function resolveLogTarget(
  target: LogTarget,
  containerIdMap: Record<string, string>,
): { cacheKey: string; containerId?: string } {
  if (typeof target === 'string') {
    return {
      cacheKey: target,
      containerId: containerIdMap[target],
    };
  }

  const id = typeof target.id === 'string' && target.id.length > 0 ? target.id : undefined;
  const name = typeof target.name === 'string' ? target.name : '';
  const aliasId = name ? containerIdMap[name] : undefined;
  const containerId = id ?? aliasId;
  return {
    cacheKey: name && aliasId === containerId ? name : (containerId ?? name),
    containerId,
  };
}

export function useContainerLogs(input: UseContainerLogsInput) {
  const containerLogsCache = ref<Record<string, string[]>>({});
  const containerLogsLoading = ref<Record<string, boolean>>({});

  async function loadContainerLogs(target: LogTarget, force = false) {
    const { cacheKey, containerId } = resolveLogTarget(target, input.containerIdMap.value);
    if (!containerId) {
      return;
    }
    if (!cacheKey) {
      return;
    }
    if (!force && containerLogsCache.value[cacheKey]) {
      return;
    }
    containerLogsLoading.value[cacheKey] = true;
    try {
      const result = await fetchContainerLogs(containerId, 100);
      const logs = result?.logs ?? '';
      containerLogsCache.value[cacheKey] = logs
        ? logs.split('\n').filter((line: string) => line.length > 0)
        : ['No logs available for this container'];
    } catch {
      containerLogsCache.value[cacheKey] = ['Failed to load container logs'];
    } finally {
      containerLogsLoading.value[cacheKey] = false;
    }
  }

  function getContainerLogs(target: LogTarget): string[] {
    const { cacheKey } = resolveLogTarget(target, input.containerIdMap.value);
    if (!cacheKey) {
      return ['Loading logs...'];
    }
    if (!containerLogsCache.value[cacheKey]) {
      void loadContainerLogs(target);
      return ['Loading logs...'];
    }
    return containerLogsCache.value[cacheKey];
  }

  const {
    logContainer: containerLogRef,
    scrollBlocked: containerScrollBlocked,
    scrollToBottom: containerScrollToBottom,
    handleLogScroll: containerHandleLogScroll,
    resumeAutoScroll: containerResumeAutoScroll,
  } = useLogViewport();

  async function refreshCurrentContainerLogs() {
    if (input.selectedContainer.value) {
      await loadContainerLogs(input.selectedContainer.value, true);
    }
  }

  const { autoFetchInterval: containerAutoFetchInterval } = useAutoFetchLogs({
    fetchFn: refreshCurrentContainerLogs,
    scrollToBottom: containerScrollToBottom,
    scrollBlocked: containerScrollBlocked,
  });

  watch([() => input.selectedContainer.value, () => input.activeDetailTab.value], () => {
    containerAutoFetchInterval.value = 0;
  });

  return {
    containerAutoFetchInterval,
    containerHandleLogScroll,
    containerLogRef,
    containerResumeAutoScroll,
    containerScrollBlocked,
    getContainerLogs,
    loadContainerLogs,
  };
}
