import { computed, onMounted, onScopeDispose, type Ref, ref } from 'vue';
import { getAgentRoster, getAgents } from '../../services/agent';
import {
  type FleetWatcher,
  getAllWatchers,
  type InventoryRefreshResult,
  refreshWatcherInventory,
} from '../../services/watcher';
import type { Container } from '../../types/container';
import { errorMessage } from '../../utils/error';

interface FleetHealthInput {
  containers: Ref<Container[]>;
  inventoryAvailable: Readonly<Ref<boolean>>;
  busy: Readonly<Ref<boolean>>;
  loadContainers: () => Promise<void>;
}

interface RefreshOutcome {
  complete: boolean;
  reloadFailed: boolean;
  results: {
    id: string;
    name: string;
    authoritative: boolean;
    errors: InventoryRefreshResult['errors'];
  }[];
}

function identity(agent?: string) {
  return JSON.stringify(agent ? ['agent', agent] : ['local']);
}

function containerTotal(stats: unknown): number | undefined {
  const total = (stats as { total?: unknown } | undefined)?.total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : undefined;
}

export function useFleetHealth(input: FleetHealthInput) {
  const agents = ref<Awaited<ReturnType<typeof getAgents>>>([]);
  const roster = ref<Awaited<ReturnType<typeof getAgentRoster>>>([]);
  const knownNames = ref<string[]>([]);
  const watchers = ref<FleetWatcher[]>([]);
  const agentError = ref(false);
  const rosterError = ref(false);
  const watcherError = ref(false);
  const loading = ref(false);
  const refreshing = ref<string | null>(null);
  const outcomes = ref<Record<string, RefreshOutcome>>({});
  let pending: Promise<void> | undefined;
  let trailing = false;
  let disposed = false;

  function load(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    loading.value = true;
    pending = Promise.all([
      getAgentRoster()
        .then((data) => {
          roster.value = data;
          rosterError.value = false;
        })
        .catch(() => {
          rosterError.value = true;
        }),
      getAgents()
        .then((data) => {
          agents.value = data;
          agentError.value = false;
        })
        .catch(() => {
          agentError.value = true;
        }),
      getAllWatchers()
        .then((data) => {
          watchers.value = data as FleetWatcher[];
          watcherError.value = false;
        })
        .catch(() => {
          watcherError.value = true;
        }),
    ])
      .then(() => {
        if (agentError.value && rosterError.value) return;
        const currentAgents = agentError.value ? [] : agents.value;
        const currentRoster = rosterError.value ? [] : roster.value;
        knownNames.value = [
          ...new Set([...currentAgents, ...currentRoster].map(({ name }) => name)),
        ];
      })
      .finally(() => {
        loading.value = false;
        pending = undefined;
        if (trailing) {
          trailing = false;
          void load();
        }
      });
    return pending;
  }

  const rows = computed(() => {
    const agentsByName = new Map(agents.value.map((agent) => [agent.name, agent]));
    const sources = knownNames.value
      .map((name) => {
        const agent = agentsByName.get(name);
        return {
          key: identity(name),
          agent: name,
          status:
            agentError.value || !agent
              ? ('unavailable' as const)
              : agent.connected
                ? ('connected' as const)
                : ('disconnected' as const),
          total: containerTotal(agent?.containers),
          lastSeen: typeof agent?.lastSeen === 'string' ? agent.lastSeen : undefined,
          lastKnown: agent !== undefined && (agentError.value || !agent.connected),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    const localWatchers = watchers.value.filter((watcher) => !watcher.agent);
    const local = localWatchers.length
      ? [
          {
            key: identity(),
            agent: undefined,
            status: 'configured' as const,
            total: input.inventoryAvailable.value
              ? input.containers.value.filter((container) => !container.agent).length
              : undefined,
            lastSeen: undefined,
            lastKnown: !input.inventoryAvailable.value,
          },
        ]
      : [];
    return [...local, ...sources].map((source) => {
      const children = watchers.value.filter((watcher) => identity(watcher.agent) === source.key);
      const targets = children.filter((watcher) => watcher.type === 'docker');
      const supported =
        targets.length > 0 &&
        targets.every((watcher) => watcher.metadata?.inventoryRefreshSupported === true);
      return {
        ...source,
        watchers: children,
        supported,
        canRefresh:
          supported &&
          !agentError.value &&
          !watcherError.value &&
          !loading.value &&
          !refreshing.value &&
          !input.busy.value &&
          (source.status === 'configured' || source.status === 'connected'),
      };
    });
  });

  async function refresh(key: string) {
    const row = rows.value.find((candidate) => candidate.key === key);
    if (!row?.canRefresh) return;
    const targets = row.watchers
      .filter((watcher) => watcher.type === 'docker')
      .map(({ id, type, name, agent }) => ({ id, type, name, agent }));
    refreshing.value = key;
    const outcome: RefreshOutcome = { complete: true, reloadFailed: false, results: [] };
    for (const target of targets) {
      try {
        const result = await refreshWatcherInventory(target);
        outcome.results.push({
          id: target.id,
          name: target.name,
          authoritative: result.authoritative,
          errors: result.errors,
        });
        if (!result.authoritative || result.errors.length > 0) outcome.complete = false;
      } catch (error) {
        outcome.complete = false;
        outcome.results.push({
          id: target.id,
          name: target.name,
          authoritative: false,
          errors: [{ phase: 'request', message: errorMessage(error) }],
        });
      }
    }
    try {
      await input.loadContainers();
    } catch {
      outcome.reloadFailed = true;
    }
    outcomes.value = { ...outcomes.value, [key]: outcome };
    refreshing.value = null;
    await load();
  }

  function handleStatusChange() {
    if (pending) trailing = true;
    else void load();
  }
  const events = ['dd:sse-agent-status-changed', 'dd:sse-connected', 'dd:sse-resync-required'];
  onMounted(() => {
    void load();
    for (const event of events) globalThis.addEventListener(event, handleStatusChange);
  });
  onScopeDispose(() => {
    disposed = true;
    for (const event of events) globalThis.removeEventListener(event, handleStatusChange);
  });
  return {
    rows,
    loading,
    agentError,
    rosterError,
    watcherError,
    refreshing,
    outcomes,
    load,
    refresh,
  };
}
