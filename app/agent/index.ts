import log from '../log/index.js';
import { getState } from '../registry/index.js';
import { AgentClient, type AgentClientConfig } from './AgentClient.js';
import { addAgent } from './manager.js';

export * from './manager.js';

export async function init(): Promise<void> {
  const registryState = getState();
  const agents = registryState.agent;

  Object.keys(agents).forEach((agentId) => {
    const agentComponent = agents[agentId];
    const name = agentComponent.name;
    const config = agentComponent.configuration as AgentClientConfig;

    if (!config.host) {
      log.warn(`Skipping agent ${name}: Missing host`);
      return;
    }
    if (config.authmode === 'ed25519') {
      if (!config.signingkeyid || !config.signingkey) {
        log.warn(`Skipping agent ${name}: Missing signingkeyid or signingkey for ed25519 authmode`);
        return;
      }
    } else if (!config.secret) {
      log.warn(`Skipping agent ${name}: Missing secret`);
      return;
    }

    const client = new AgentClient(name, config);
    addAgent(client);
    // Start without awaiting to not block main init
    client.init();
  });
}
