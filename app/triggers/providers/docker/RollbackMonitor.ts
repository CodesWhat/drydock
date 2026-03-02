// @ts-nocheck

class RollbackMonitor {
  getPreferredLabelValue;

  getLogger;

  getCurrentContainer;

  inspectContainer;

  startHealthMonitor;

  getTriggerInstance;

  constructor(options = {}) {
    this.getPreferredLabelValue = options.getPreferredLabelValue;
    this.getLogger = options.getLogger || (() => undefined);
    this.getCurrentContainer = options.getCurrentContainer;
    this.inspectContainer = options.inspectContainer;
    this.startHealthMonitor = options.startHealthMonitor;
    this.getTriggerInstance = options.getTriggerInstance || (() => undefined);
  }

  getConfig(container) {
    const DEFAULT_ROLLBACK_WINDOW = 300000;
    const DEFAULT_ROLLBACK_INTERVAL = 10000;
    const logger = this.getLogger()?.child?.({});

    const parsedWindow = Number.parseInt(
      this.getPreferredLabelValue(
        container.labels,
        'dd.rollback.window',
        'wud.rollback.window',
        logger,
      ) ?? String(DEFAULT_ROLLBACK_WINDOW),
      10,
    );
    const parsedInterval = Number.parseInt(
      this.getPreferredLabelValue(
        container.labels,
        'dd.rollback.interval',
        'wud.rollback.interval',
        logger,
      ) ?? String(DEFAULT_ROLLBACK_INTERVAL),
      10,
    );

    const rollbackWindow =
      Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : DEFAULT_ROLLBACK_WINDOW;
    const rollbackInterval =
      Number.isFinite(parsedInterval) && parsedInterval > 0
        ? parsedInterval
        : DEFAULT_ROLLBACK_INTERVAL;

    if (rollbackWindow !== parsedWindow) {
      this.getLogger()
        ?.child?.({})
        ?.warn?.(
          `Invalid rollback window label value — using default ${DEFAULT_ROLLBACK_WINDOW}ms`,
        );
    }
    if (rollbackInterval !== parsedInterval) {
      this.getLogger()
        ?.child?.({})
        ?.warn?.(
          `Invalid rollback interval label value — using default ${DEFAULT_ROLLBACK_INTERVAL}ms`,
        );
    }

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

  async start(dockerApi, container, rollbackConfig, logContainer) {
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
    this.startHealthMonitor({
      dockerApi,
      containerId: newContainerId,
      containerName: container.name,
      backupImageTag: container.image.tag.value,
      backupImageDigest: container.image.digest?.repo,
      window: rollbackConfig.rollbackWindow,
      interval: rollbackConfig.rollbackInterval,
      triggerInstance: this.getTriggerInstance(),
      log: logContainer,
    });
  }
}

export default RollbackMonitor;
