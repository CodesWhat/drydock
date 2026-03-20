import { onScopeDispose, ref } from 'vue';
import {
  createSystemLogStreamConnection,
  type SystemLogEntry,
  type SystemLogStreamConnection,
  type SystemLogStreamQuery,
  type SystemLogStreamStatus,
} from '../services/system-log-stream';

const MAX_ENTRIES = 2000;

export function useSystemLogStream(options?: {
  webSocketFactory?: (url: string) => WebSocket;
  location?: Location;
}) {
  const entries = ref<SystemLogEntry[]>([]);
  const status = ref<SystemLogStreamStatus>('disconnected');
  let connection: SystemLogStreamConnection | undefined;

  function connect(query?: SystemLogStreamQuery) {
    disconnect();
    entries.value = [];
    connection = createSystemLogStreamConnection({
      query,
      onMessage(entry) {
        const current = entries.value;
        if (current.length >= MAX_ENTRIES) {
          entries.value = [...current.slice(current.length - MAX_ENTRIES + 1), entry];
        } else {
          entries.value = [...current, entry];
        }
      },
      onStatus(newStatus) {
        status.value = newStatus;
      },
      webSocketFactory: options?.webSocketFactory,
      location: options?.location,
    });
  }

  function disconnect() {
    if (connection) {
      connection.close();
      connection = undefined;
      status.value = 'disconnected';
    }
  }

  function updateFilters(query: SystemLogStreamQuery) {
    if (!connection) {
      connect(query);
      return;
    }
    entries.value = [];
    connection.update(query);
  }

  function clear() {
    entries.value = [];
  }

  onScopeDispose(() => {
    disconnect();
  });

  return {
    entries,
    status,
    connect,
    disconnect,
    updateFilters,
    clear,
  };
}
