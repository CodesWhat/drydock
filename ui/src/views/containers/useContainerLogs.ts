import { type Ref, ref, watch } from 'vue';
import { useAutoFetchLogs, useLogViewport } from '../../composables/useLogViewerBehavior';
import { getContainerLogs as fetchContainerLogs } from '../../services/container';
import type { Container } from '../../types/container';

interface UseContainerLogsInput {
  activeDetailTab: Readonly<Ref<string>>;
  containerIdMap: Readonly<Ref<Record<string, string>>>;
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
}

export function useContainerLogs(input: UseContainerLogsInput) {
  const containerLogsCache = ref<Record<string, string[]>>({});
  const containerLogsLoading = ref<Record<string, boolean>>({});

  async function loadContainerLogs(containerName: string, force = false) {
    const containerId = input.containerIdMap.value[containerName];
    if (!containerId) {
      return;
    }
    if (!force && containerLogsCache.value[containerName]) {
      return;
    }
    containerLogsLoading.value[containerName] = true;
    try {
      const result = await fetchContainerLogs(containerId, 100);
      const logs = result?.logs ?? '';
      containerLogsCache.value[containerName] = logs
        ? logs.split('\n').filter((line: string) => line.length > 0)
        : ['No logs available for this container'];
    } catch {
      containerLogsCache.value[containerName] = ['Failed to load container logs'];
    } finally {
      containerLogsLoading.value[containerName] = false;
    }
  }

  function getContainerLogs(containerName: string): string[] {
    if (!containerLogsCache.value[containerName]) {
      void loadContainerLogs(containerName);
      return ['Loading logs...'];
    }
    return containerLogsCache.value[containerName];
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
      await loadContainerLogs(input.selectedContainer.value.name, true);
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
