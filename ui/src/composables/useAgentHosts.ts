import { readonly, ref } from 'vue';
import { getAgents } from '../services/agent';

type AgentHostMap = Record<string, string>;

// Module-level singleton state shared by every composable consumer.
const hostsByAgent = ref<AgentHostMap>({});
const portwingAgents = ref<Record<string, true>>({});
const loaded = ref(false);
const loading = ref(false);
let loadPromise: Promise<void> | null = null;

function buildHostMap(agents: Array<{ name?: unknown; host?: unknown }>): AgentHostMap {
  const map: AgentHostMap = {};
  for (const agent of agents) {
    const name = typeof agent.name === 'string' ? agent.name.trim() : '';
    const host = typeof agent.host === 'string' ? agent.host.trim() : '';
    if (!name || !host) {
      continue;
    }
    map[name] = host;
  }
  return map;
}

function buildPortwingMap(agents: Array<{ name?: unknown; portwing?: unknown }>) {
  const map: Record<string, true> = {};
  for (const agent of agents) {
    if (typeof agent.name === 'string' && agent.portwing === true) {
      map[agent.name.trim()] = true;
    }
  }
  return map;
}

async function loadAgentHosts(): Promise<void> {
  if (loaded.value) {
    return;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loading.value = true;

  loadPromise = (async () => {
    try {
      const agents = await getAgents();
      hostsByAgent.value = buildHostMap(agents);
      portwingAgents.value = buildPortwingMap(agents);
      loaded.value = true;
    } catch {
      hostsByAgent.value = {};
      portwingAgents.value = {};
    } finally {
      loading.value = false;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function resolveHost(agentName: string | undefined, fallback: string): string {
  if (!agentName) {
    return fallback;
  }
  const host = hostsByAgent.value[agentName];
  return host && host.length > 0 ? host : fallback;
}

/** Portwing agents have no env reveal route, so the UI hides the control for their containers. */
function isPortwingAgent(agentName: string | undefined): boolean {
  return agentName !== undefined && portwingAgents.value[agentName] === true;
}

interface UseAgentHostsOptions {
  autoLoad?: boolean;
}

export function useAgentHosts(options: UseAgentHostsOptions = {}) {
  if (options.autoLoad !== false && !loaded.value && !loadPromise) {
    void loadAgentHosts();
  }

  return {
    hostsByAgent: readonly(hostsByAgent),
    loaded: readonly(loaded),
    loadAgentHosts,
    resolveHost,
    isPortwingAgent,
  };
}

export { loadAgentHosts };
