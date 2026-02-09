// @ts-nocheck
import { getVersion } from './configuration';
import log from './log';
import * as store from './store';
import * as registry from './registry';
import * as api from './api';
import * as prometheus from './prometheus';
import * as agentServer from './agent/api';
import * as agentManager from './agent';

async function main() {
    const isAgent = process.argv.includes('--agent');
    const mode = isAgent ? 'Agent' : 'Controller';
    log.info(`WUD is starting in ${mode} mode (version = ${getVersion()})`);

    // Init store
    await store.init({ memory: isAgent });

    if (!isAgent) {
        // Start Prometheus registry
        prometheus.init();
    }

    // Init registry
    await registry.init({ agent: isAgent });

    if (isAgent) {
        // Start Agent Server
        await agentServer.init();
    } else {
        // Init Agent Manager (Controller mode)
        await agentManager.init();

        // Init api
        await api.init();
    }
}
main();
