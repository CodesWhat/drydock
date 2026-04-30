import dns from 'node:dns';
import * as agentServer from './agent/api/index.js';
import * as agentManager from './agent/index.js';
import * as api from './api/index.js';
import { getDnsMode } from './configuration/index.js';
import { runConfigMigrateCommandIfRequested } from './configuration/migrate-cli.js';
import log from './log/index.js';
import * as prometheus from './prometheus/index.js';
import * as registry from './registry/index.js';
import * as securityScheduler from './security/scheduler.js';
import * as store from './store/index.js';
import { recoverQueuedOperationsOnStartup } from './updates/recovery.js';

// Configure DNS result ordering (DD_DNS_MODE, default: ipv4first).
// Defaults to IPv4-first to work around musl libc (Alpine) resolver issues
// that cause getaddrinfo EAI_AGAIN errors (#161).
dns.setDefaultResultOrder(getDnsMode());

const commandExitCode = runConfigMigrateCommandIfRequested(process.argv.slice(2));

if (commandExitCode !== null) {
  if (commandExitCode !== 0) {
    process.exitCode = commandExitCode;
  }
} else {
  const isAgent = process.argv.includes('--agent');
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const runAsRootEnabled = process.env.DD_RUN_AS_ROOT === 'true';
  const insecureRootAcknowledged = process.env.DD_ALLOW_INSECURE_ROOT === 'true';
  log.info('drydock is starting');

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

    // Init scheduled security scanning
    securityScheduler.init();

    // Recover queued update operations from a previous process run.
    // Resumable in-progress phases (pulling) were reset to queued during
    // store init; this dispatches all queued operations through the
    // standard fire-and-forget pipeline.
    recoverQueuedOperationsOnStartup();
  }
}
