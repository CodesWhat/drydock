import { parseEnvNonNegativeInteger } from '../../../util/parse.js';
import { resolveFunctionDependencies } from './dependency-constructor.js';

type RollbackMonitorLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type RollbackMonitorRootLogger = {
  child?: (bindings?: Record<string, unknown>) => { warn?: (message: string) => void } | undefined;
};

type RollbackContainer = {
  name: string;
  labels?: Record<string, string>;
  image: {
    tag: { value: string };
    digest?: { repo?: string };
  };
  updateKind?: {
    remoteValue?: string | null;
  };
};

type RollbackConfig = {
  autoRollback: boolean;
  rollbackWindow: number;
  rollbackInterval: number;
};

type RollbackMonitorDependencies = {
  getPreferredLabelValue: (
    labels: Record<string, string> | undefined,
    ddKey: string,
    wudKey: string,
    logger?: unknown,
  ) => string | undefined;
  getLogger: () => RollbackMonitorRootLogger | undefined;
  getCurrentContainer: (dockerApi: unknown, query: { id: string }) => Promise<unknown>;
  inspectContainer: (
    container: unknown,
    logContainer: RollbackMonitorLogger,
  ) => Promise<{ Id: string; State?: { Health?: unknown } } | undefined>;
  startHealthMonitor: (options: {
    dockerApi: unknown;
    containerId: string;
    containerName: string;
    backupImageTag: string;
    backupImageDigest?: string;
    window: number;
    interval: number;
    triggerInstance: unknown;
    log: RollbackMonitorLogger;
  }) => void;
  getTriggerInstance: () => unknown;
};

type RollbackMonitorConstructorOptions = Omit<
  RollbackMonitorDependencies,
  'getLogger' | 'getTriggerInstance'
> & {
  getLogger?: RollbackMonitorDependencies['getLogger'];
  getTriggerInstance?: RollbackMonitorDependencies['getTriggerInstance'];
};

const REQUIRED_ROLLBACK_MONITOR_DEPENDENCY_KEYS = [
  'getPreferredLabelValue',
  'getCurrentContainer',
  'inspectContainer',
  'startHealthMonitor',
] as const;
const DEFAULT_ROLLBACK_WINDOW = 300000;
const DEFAULT_ROLLBACK_INTERVAL = 10000;

function parsePositiveDurationLabel(
  rawValue: string | undefined,
  labelName: string,
  defaultValue: number,
  warningMessage: string,
  logger: { warn?: (message: string) => void } | undefined,
): number {
  try {
    const parsedValue = parseEnvNonNegativeInteger(rawValue ?? String(defaultValue), labelName);
    if (parsedValue !== undefined && parsedValue > 0) {
      return parsedValue;
    }
  } catch {
    // Fall through to the existing default-and-warn behavior.
  }

  logger?.warn?.(warningMessage);
  return defaultValue;
}

class RollbackMonitor {
  getPreferredLabelValue: RollbackMonitorDependencies['getPreferredLabelValue'];

  getLogger: RollbackMonitorDependencies['getLogger'];

  getCurrentContainer: RollbackMonitorDependencies['getCurrentContainer'];

  inspectContainer: RollbackMonitorDependencies['inspectContainer'];

  startHealthMonitor: RollbackMonitorDependencies['startHealthMonitor'];

  getTriggerInstance: RollbackMonitorDependencies['getTriggerInstance'];

  constructor(options: RollbackMonitorConstructorOptions) {
    const dependencies = resolveFunctionDependencies<RollbackMonitorDependencies>(options, {
      requiredKeys: REQUIRED_ROLLBACK_MONITOR_DEPENDENCY_KEYS,
      defaults: {
        getLogger: () => undefined,
        getTriggerInstance: () => undefined,
      },
      componentName: 'RollbackMonitor',
    });
    Object.assign(this, dependencies);
  }

  getConfig(container: RollbackContainer): RollbackConfig {
    const logger = this.getLogger()?.child?.({});
    const rollbackWindow = parsePositiveDurationLabel(
      this.getPreferredLabelValue(
        container.labels,
        'dd.rollback.window',
        'wud.rollback.window',
        logger,
      ),
      'dd.rollback.window',
      DEFAULT_ROLLBACK_WINDOW,
      `Invalid rollback window label value — using default ${DEFAULT_ROLLBACK_WINDOW}ms`,
      logger,
    );
    const rollbackInterval = parsePositiveDurationLabel(
      this.getPreferredLabelValue(
        container.labels,
        'dd.rollback.interval',
        'wud.rollback.interval',
        logger,
      ),
      'dd.rollback.interval',
      DEFAULT_ROLLBACK_INTERVAL,
      `Invalid rollback interval label value — using default ${DEFAULT_ROLLBACK_INTERVAL}ms`,
      logger,
    );

    return {
      autoRollback:
        (
          this.getPreferredLabelValue(
            container.labels,
            'dd.rollback.auto',
            'wud.rollback.auto',
            logger,
          ) ?? 'false'
        ).toLowerCase() === 'true',
      rollbackWindow,
      rollbackInterval,
    };
  }

  async start(
    dockerApi: unknown,
    container: RollbackContainer,
    rollbackConfig: RollbackConfig,
    logContainer: RollbackMonitorLogger,
  ) {
    if (!rollbackConfig.autoRollback) {
      return;
    }

    const newContainer = await this.getCurrentContainer(dockerApi, { id: container.name });
    if (newContainer == null) {
      logContainer.warn('Cannot find recreated container by name — skipping health monitoring');
      return;
    }

    const newContainerSpec = await this.inspectContainer(newContainer, logContainer);
    const hasHealthcheck = !!newContainerSpec?.State?.Health;
    if (!hasHealthcheck) {
      logContainer.warn(
        'Auto-rollback enabled but container has no HEALTHCHECK defined — skipping health monitoring',
      );
      return;
    }

    const newContainerId = newContainerSpec.Id;

    logContainer.info(
      `Starting health monitor (window=${rollbackConfig.rollbackWindow}ms, interval=${rollbackConfig.rollbackInterval}ms)`,
    );
    const failingImageTag = container.updateKind?.remoteValue ?? container.image.tag.value;
    this.startHealthMonitor({
      dockerApi,
      containerId: newContainerId,
      containerName: container.name,
      backupImageTag: failingImageTag,
      backupImageDigest: container.image.digest?.repo,
      window: rollbackConfig.rollbackWindow,
      interval: rollbackConfig.rollbackInterval,
      triggerInstance: this.getTriggerInstance(),
      log: logContainer,
    });
  }
}

export default RollbackMonitor;
