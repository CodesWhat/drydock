import { onScopeDispose, ref } from 'vue';
import {
  createSystemLogStreamConnection,
  type SystemLogEntry,
  type SystemLogStreamConnection,
  type SystemLogStreamQuery,
  type SystemLogStreamStatus,
} from '../services/system-log-stream';

const MAX_ENTRIES = 2000;
// AppLayout raises this each time the app's event stream connects, which takes
// a session the server accepts.
const SESSION_BACK_EVENT = 'dd:sse-connected';

export function useSystemLogStream(options?: {
  webSocketFactory?: (url: string) => WebSocket;
  location?: Location;
}) {
  const entries = ref<SystemLogEntry[]>([]);
  const status = ref<SystemLogStreamStatus>('disconnected');
  let connection: SystemLogStreamConnection | undefined;
  // A socket has been asked for and has not yet said whether it opened.
  let opening = false;

  function connect(query?: SystemLogStreamQuery) {
    disconnect();
    entries.value = [];
    opening = true;
    connection = createSystemLogStreamConnection({
      query,
      onMessage(entry) {
        if (entries.value.length >= MAX_ENTRIES) {
          entries.value = [...entries.value.slice(-(MAX_ENTRIES - 1)), entry];
        } else {
          entries.value.push(entry);
        }
      },
      onStatus(newStatus) {
        opening = false;
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
    opening = true;
    connection.update(query);
  }

  /**
   * The server closes the socket when the session behind it ends (a sign-in
   * elsewhere in the browser, a two-factor change) and the socket does not
   * reconnect by itself, since retrying against a session that was just refused
   * only earns a 401. Once the app has a session again the stream is reopened,
   * one attempt per time the session comes back, with the filters it had.
   */
  function reopenAfterSessionReturns() {
    if (connection && !opening && status.value === 'disconnected') {
      updateFilters({});
    }
  }
  globalThis.addEventListener(SESSION_BACK_EVENT, reopenAfterSessionReturns);

  function clear() {
    entries.value = [];
  }

  onScopeDispose(() => {
    globalThis.removeEventListener(SESSION_BACK_EVENT, reopenAfterSessionReturns);
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
