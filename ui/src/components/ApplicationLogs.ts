import { computed, defineComponent, nextTick, onMounted, ref, watch } from 'vue';
import {
  LOG_AUTO_FETCH_INTERVALS,
  useAutoFetchLogs,
  useLogViewport,
} from '@/composables/useLogViewerBehavior';
import { getAgents } from '@/services/agent';
import { getLogEntries } from '@/services/log';

type LogEntry = {
  timestamp: string;
  level: string;
  component: string;
  msg: string;
};

type AgentInfo = {
  name: string;
  connected: boolean;
};

type SourceItem = {
  title: string;
  value: string;
  props?: {
    disabled: boolean;
  };
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default defineComponent({
  props: {
    configuredLevel: {
      type: String,
      default: '',
    },
  },
  setup() {
    const entries = ref<LogEntry[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const level = ref('all');
    const tail = ref(100);
    const source = ref('server');
    const autoFetchSeconds = ref(5);
    const agents = ref<AgentInfo[]>([]);
    const { logPre, scrollBlocked, scrollToBottom, handleLogScroll, resumeAutoScroll } =
      useLogViewport();

    const sourceItems = computed<SourceItem[]>(function buildSourceItems() {
      const items: SourceItem[] = [{ title: 'Server', value: 'server' }];
      for (const agent of agents.value) {
        items.push({
          title: agent.name,
          value: agent.name,
          props: { disabled: !agent.connected },
        });
      }
      return items;
    });

    const formattedLogs = computed<string>(function formatLogLines() {
      return entries.value
        .map(
          (entry) =>
            `${new Date(entry.timestamp).toISOString()} [${entry.level.toUpperCase().padEnd(5)}] [${entry.component}] ${entry.msg}`,
        )
        .join('\n');
    });

    const fetchAgents = async function fetchAgents(): Promise<void> {
      try {
        agents.value = await getAgents();
      } catch {
        agents.value = [];
      }
    };

    const fetchEntries = async function fetchEntries(): Promise<void> {
      loading.value = true;
      error.value = null;
      try {
        entries.value = await getLogEntries({
          level: level.value === 'all' ? undefined : level.value,
          tail: tail.value,
          agent: source.value === 'server' ? undefined : source.value,
        });
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
      fetchLogs: fetchEntries,
    });

    const levelColor = function levelColor(levelName: string): string {
      switch (levelName) {
        case 'error':
        case 'fatal':
          return '#e06c75';
        case 'warn':
          return '#e5c07b';
        case 'debug':
        case 'trace':
          return '#61afef';
        default:
          return '#d4d4d4';
      }
    };

    onMounted(function loadLogsOnMount() {
      void fetchAgents();
      void fetchEntries();
      startAutoFetch();
    });

    watch([level, tail, source], function reloadLogsOnFilterChange() {
      void fetchEntries();
    });

    return {
      entries,
      loading,
      error,
      level,
      tail,
      source,
      autoFetchSeconds,
      autoFetchItems: LOG_AUTO_FETCH_INTERVALS,
      agents,
      sourceItems,
      formattedLogs,
      scrollBlocked,
      logPre,
      fetchEntries,
      levelColor,
      handleLogScroll,
      resumeAutoScroll,
    };
  },
});
