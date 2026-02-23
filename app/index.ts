import * as agentServer from './agent/api/index.js';
import * as agentManager from './agent/index.js';
import * as api from './api/index.js';
import { getVersion } from './configuration/index.js';
import { runConfigMigrateCommandIfRequested } from './configuration/migrate-cli.js';
import log from './log/index.js';
import * as prometheus from './prometheus/index.js';
import * as registry from './registry/index.js';
import * as store from './store/index.js';

const commandExitCode = runConfigMigrateCommandIfRequested(process.argv.slice(2));

if (commandExitCode !== null) {
  if (commandExitCode !== 0) {
    process.exitCode = commandExitCode;
  }
} else {
  const isAgent = process.argv.includes('--agent');
  const mode = isAgent ? 'Agent' : 'Controller';
  const version = String(getVersion()).replaceAll(/[^a-zA-Z0-9._\-+]/g, '');
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const runAsRootEnabled = process.env.DD_RUN_AS_ROOT === 'true';
  const insecureRootAcknowledged = process.env.DD_ALLOW_INSECURE_ROOT === 'true';
  log.info(`drydock is starting in ${mode} mode (version = ${version})`);

  if (runningAsRoot && runAsRootEnabled && !insecureRootAcknowledged) {
    throw new Error(
      'DD_RUN_AS_ROOT=true requires DD_ALLOW_INSECURE_ROOT=true (break-glass). Prefer socket-proxy mode for least privilege.',
    );
  }

  if (runningAsRoot && runAsRootEnabled && insecureRootAcknowledged) {
    log.warn(
      'Running in insecure root mode (DD_RUN_AS_ROOT=true + DD_ALLOW_INSECURE_ROOT=true); use socket-proxy mode when possible.',
    );
  }

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
