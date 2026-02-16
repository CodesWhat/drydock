import { defineComponent, nextTick, onMounted, type PropType, ref, watch } from 'vue';
import {
  LOG_AUTO_FETCH_INTERVALS,
  useAutoFetchLogs,
  useLogViewport,
} from '@/composables/useLogViewerBehavior';
import { getContainerLogs } from '../services/container';

type ContainerLogTarget = {
  id: string;
};

type ContainerLogsResponse = {
  logs?: unknown;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default defineComponent({
  props: {
    container: {
      type: Object as PropType<ContainerLogTarget>,
      required: true,
    },
  },
  setup: function setup(props) {
    const logs = ref('');
    const loading = ref(false);
    const error = ref('');
    const tail = ref(100);
    const autoFetchSeconds = ref(5);
    const { logPre, scrollBlocked, scrollToBottom, handleLogScroll, resumeAutoScroll } =
      useLogViewport();

    const fetchLogs = async function fetchLogs(): Promise<void> {
      loading.value = true;
      error.value = '';
      try {
        const result = (await getContainerLogs(
          props.container.id,
          tail.value,
        )) as ContainerLogsResponse;
        logs.value = typeof result.logs === 'string' ? result.logs : '';
        await nextTick();
        if (!scrollBlocked.value) {
          scrollToBottom();
        }
      } catch (e: unknown) {
        error.value = toErrorMessage(e);
      } finally {
        loading.value = false;
      }
    };

    const { startAutoFetch } = useAutoFetchLogs({
      intervalSeconds: autoFetchSeconds,
      loading,
      fetchLogs,
    });

    onMounted(function loadLogsOnMount() {
      void fetchLogs();
      startAutoFetch();
    });

    watch(tail, function reloadLogsOnTailChange() {
      void fetchLogs();
    });

    watch(
      () => props.container.id,
      function reloadLogsOnContainerChange() {
        scrollBlocked.value = false;
        void fetchLogs();
      },
    );

    return {
      logs,
      loading,
      error,
      tail,
      autoFetchSeconds,
      autoFetchItems: LOG_AUTO_FETCH_INTERVALS,
      scrollBlocked,
      logPre,
      fetchLogs,
      handleLogScroll,
      resumeAutoScroll,
    };
  },
});
