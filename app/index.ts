// @ts-nocheck
import { getVersion } from './configuration/index.js';
import log from './log/index.js';
import * as store from './store/index.js';
import * as registry from './registry/index.js';
import * as api from './api/index.js';
import * as prometheus from './prometheus/index.js';
import * as agentServer from './agent/api/index.js';
import * as agentManager from './agent/index.js';

async function main() {
    const isAgent = process.argv.includes('--agent');
    const mode = isAgent ? 'Agent' : 'Controller';
    const version = String(getVersion()).replaceAll(/[^a-zA-Z0-9._\-+]/g, '');
    log.info(`drydock is starting in ${mode} mode (version = ${version})`);

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
