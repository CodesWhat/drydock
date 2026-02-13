import { defineComponent, onMounted, ref, watch, type PropType } from 'vue';
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
      required: true
    }
  },
  setup: function setup(props) {
    const logs = ref('');
    const loading = ref(false);
    const error = ref('');
    const tail = ref(100);

    const fetchLogs = async function fetchLogs(): Promise<void> {
      loading.value = true;
      error.value = '';
      try {
        const result = (await getContainerLogs(
          props.container.id,
          tail.value
        )) as ContainerLogsResponse;
        logs.value = typeof result.logs === 'string' ? result.logs : '';
      } catch (e: unknown) {
        error.value = toErrorMessage(e);
      } finally {
        loading.value = false;
      }
    };

    onMounted(function loadLogsOnMount() {
      void fetchLogs();
    });

    watch(tail, function reloadLogsOnTailChange() {
      void fetchLogs();
    });

    return {
      logs,
      loading,
      error,
      tail,
      fetchLogs
    };
  }
});
