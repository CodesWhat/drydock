import { afterEach, describe, expect, test, vi } from 'vitest';
import type { NotificationOutboxEntry } from './model/notification-outbox.js';

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const originalGetuid = process.getuid;

interface EntryPointOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  getuid?: number | 'unavailable';
  migrateExitCode?: number | null;
  triggerState?: Record<string, unknown>;
}

async function loadEntryPoint({
  argv = ['node', 'index.js'],
  env = {},
  getuid = 501,
  migrateExitCode = null,
  triggerState = {},
}: EntryPointOptions = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();

  process.argv = argv;
  process.exitCode = undefined;
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  if (getuid === 'unavailable') {
    Object.defineProperty(process, 'getuid', {
      configurable: true,
      value: undefined,
    });
  } else {
    vi.spyOn(process, 'getuid').mockReturnValue(getuid);
  }

  const setDefaultResultOrder = vi.fn();
  const getDnsMode = vi.fn(() => 'ipv4first');
  const runConfigMigrateCommandIfRequested = vi.fn(() => migrateExitCode);
  const logInfo = vi.fn();
  const logWarn = vi.fn();
  const storeInit = vi.fn(async () => undefined);
  const prometheusInit = vi.fn();
  const registryState = { trigger: triggerState };
  const registryInit = vi.fn(async () => undefined);
  const registryGetState = vi.fn(() => registryState);
  const agentServerInit = vi.fn(async () => undefined);
  const agentManagerInit = vi.fn(async () => undefined);
  const apiInit = vi.fn(async () => undefined);
  const securitySchedulerInit = vi.fn();
  const startOutboxWorker = vi.fn();
  const recoverQueuedOperationsOnStartup = vi.fn();
  let deliverOutboxEntry: ((entry: NotificationOutboxEntry) => Promise<void>) | undefined;

  vi.doMock('node:dns', () => ({
    default: { setDefaultResultOrder },
  }));
  vi.doMock('./configuration/index.js', () => ({ getDnsMode }));
  vi.doMock('./configuration/migrate-cli.js', () => ({ runConfigMigrateCommandIfRequested }));
  vi.doMock('./log/index.js', () => ({
    default: {
      info: logInfo,
      warn: logWarn,
    },
  }));
  vi.doMock('./store/index.js', () => ({ init: storeInit }));
  vi.doMock('./prometheus/index.js', () => ({ init: prometheusInit }));
  vi.doMock('./registry/index.js', () => ({
    init: registryInit,
    getState: registryGetState,
  }));
  vi.doMock('./agent/api/index.js', () => ({ init: agentServerInit }));
  vi.doMock('./agent/index.js', () => ({ init: agentManagerInit }));
  vi.doMock('./api/index.js', () => ({ init: apiInit }));
  vi.doMock('./security/scheduler.js', () => ({ init: securitySchedulerInit }));
  vi.doMock('./notifications/outbox-worker.js', () => ({
    startOutboxWorker: vi.fn((options: { deliver: typeof deliverOutboxEntry }) => {
      deliverOutboxEntry = options.deliver;
      startOutboxWorker(options);
    }),
  }));
  vi.doMock('./updates/recovery.js', () => ({ recoverQueuedOperationsOnStartup }));

  const imported = import('./index.js');

  return {
    imported,
    setDefaultResultOrder,
    getDnsMode,
    runConfigMigrateCommandIfRequested,
    logInfo,
    logWarn,
    storeInit,
    prometheusInit,
    registryInit,
    registryGetState,
    agentServerInit,
    agentManagerInit,
    apiInit,
    securitySchedulerInit,
    startOutboxWorker,
    recoverQueuedOperationsOnStartup,
    get deliverOutboxEntry() {
      return deliverOutboxEntry;
    },
  };
}

describe('entrypoint', () => {
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    Object.defineProperty(process, 'getuid', {
      configurable: true,
      value: originalGetuid,
    });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('exits with the migration command status when config migration is requested', async () => {
    const harness = await loadEntryPoint({ migrateExitCode: 7 });

    await harness.imported;

    expect(harness.setDefaultResultOrder).toHaveBeenCalledWith('ipv4first');
    expect(harness.runConfigMigrateCommandIfRequested).toHaveBeenCalledWith([]);
    expect(process.exitCode).toBe(7);
    expect(harness.storeInit).not.toHaveBeenCalled();
  });

  test('does not set process exitCode for successful config migration commands', async () => {
    const harness = await loadEntryPoint({
      argv: ['node', 'index.js', 'config', 'migrate'],
      migrateExitCode: 0,
    });

    await harness.imported;

    expect(harness.runConfigMigrateCommandIfRequested).toHaveBeenCalledWith(['config', 'migrate']);
    expect(process.exitCode).toBeUndefined();
    expect(harness.storeInit).not.toHaveBeenCalled();
  });

  test('starts the controller runtime and dispatches outbox entries through registered triggers', async () => {
    const dispatchOutboxEntry = vi.fn(async () => undefined);
    const harness = await loadEntryPoint({
      triggerState: {
        'webhook.ops': { dispatchOutboxEntry },
        inert: {},
      },
    });

    await harness.imported;

    expect(harness.logInfo).toHaveBeenCalledWith('drydock is starting');
    expect(harness.storeInit).toHaveBeenCalledWith({ memory: false });
    expect(harness.prometheusInit).toHaveBeenCalledOnce();
    expect(harness.registryInit).toHaveBeenCalledWith({ agent: false });
    expect(harness.agentManagerInit).toHaveBeenCalledOnce();
    expect(harness.apiInit).toHaveBeenCalledOnce();
    expect(harness.securitySchedulerInit).toHaveBeenCalledOnce();
    expect(harness.startOutboxWorker).toHaveBeenCalledOnce();
    expect(harness.recoverQueuedOperationsOnStartup).toHaveBeenCalledOnce();

    const entry = {
      id: 'entry-1',
      triggerId: 'webhook.ops',
    } as NotificationOutboxEntry;
    await expect(harness.deliverOutboxEntry?.(entry)).resolves.toBeUndefined();
    expect(dispatchOutboxEntry).toHaveBeenCalledWith(entry);

    await expect(harness.deliverOutboxEntry?.({ ...entry, triggerId: 'missing' })).rejects.toThrow(
      'Trigger missing not registered for outbox delivery',
    );
    await expect(harness.deliverOutboxEntry?.({ ...entry, triggerId: 'inert' })).rejects.toThrow(
      'Trigger inert not registered for outbox delivery',
    );
  });

  test('starts the agent runtime without controller services', async () => {
    const harness = await loadEntryPoint({ argv: ['node', 'index.js', '--agent'] });

    await harness.imported;

    expect(harness.storeInit).toHaveBeenCalledWith({ memory: true });
    expect(harness.prometheusInit).not.toHaveBeenCalled();
    expect(harness.registryInit).toHaveBeenCalledWith({ agent: true });
    expect(harness.agentServerInit).toHaveBeenCalledOnce();
    expect(harness.agentManagerInit).not.toHaveBeenCalled();
    expect(harness.apiInit).not.toHaveBeenCalled();
    expect(harness.startOutboxWorker).not.toHaveBeenCalled();
    expect(harness.recoverQueuedOperationsOnStartup).not.toHaveBeenCalled();
  });

  test('blocks insecure root mode unless explicitly acknowledged', async () => {
    const harness = await loadEntryPoint({
      getuid: 0,
      env: {
        DD_RUN_AS_ROOT: 'true',
        DD_ALLOW_INSECURE_ROOT: 'false',
      },
    });

    await expect(harness.imported).rejects.toThrow(
      'DD_RUN_AS_ROOT=true requires DD_ALLOW_INSECURE_ROOT=true',
    );
    expect(harness.storeInit).not.toHaveBeenCalled();
  });

  test('does not enforce root mode when getuid is unavailable', async () => {
    const harness = await loadEntryPoint({
      getuid: 'unavailable',
      env: {
        DD_RUN_AS_ROOT: 'true',
        DD_ALLOW_INSECURE_ROOT: 'false',
      },
    });

    await harness.imported;

    expect(harness.logWarn).not.toHaveBeenCalled();
    expect(harness.storeInit).toHaveBeenCalledWith({ memory: false });
  });

  test('does not warn when running as root without DD_RUN_AS_ROOT', async () => {
    const harness = await loadEntryPoint({ getuid: 0 });

    await harness.imported;

    expect(harness.logWarn).not.toHaveBeenCalled();
    expect(harness.storeInit).toHaveBeenCalledWith({ memory: false });
  });

  test('allows acknowledged root mode and warns operators', async () => {
    const harness = await loadEntryPoint({
      getuid: 0,
      env: {
        DD_RUN_AS_ROOT: 'true',
        DD_ALLOW_INSECURE_ROOT: 'true',
      },
    });

    await harness.imported;

    expect(harness.logWarn).toHaveBeenCalledWith(
      'Running in insecure root mode (DD_RUN_AS_ROOT=true + DD_ALLOW_INSECURE_ROOT=true); use socket-proxy mode when possible.',
    );
    expect(harness.storeInit).toHaveBeenCalledWith({ memory: false });
  });
});
