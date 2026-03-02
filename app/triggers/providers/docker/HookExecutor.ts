import TriggerPipelineError from './TriggerPipelineError.js';

class HookExecutor {
  runHook;

  getPreferredLabelValue;

  getLogger;

  recordHookAudit;

  constructor(options: Record<string, any> = {}) {
    this.runHook = options.runHook;
    this.getPreferredLabelValue = options.getPreferredLabelValue;
    this.getLogger = options.getLogger || (() => undefined);
    this.recordHookAudit = options.recordHookAudit || (() => undefined);
  }

  buildHookConfig(container) {
    const logger = this.getLogger()?.child?.({});
    return {
      hookPre: this.getPreferredLabelValue(container.labels, 'dd.hook.pre', 'wud.hook.pre', logger),
      hookPost: this.getPreferredLabelValue(
        container.labels,
        'dd.hook.post',
        'wud.hook.post',
        logger,
      ),
      hookPreAbort:
        (
          this.getPreferredLabelValue(
            container.labels,
            'dd.hook.pre.abort',
            'wud.hook.pre.abort',
            logger,
          ) ?? 'true'
        ).toLowerCase() === 'true',
      hookTimeout: Number.parseInt(
        this.getPreferredLabelValue(
          container.labels,
          'dd.hook.timeout',
          'wud.hook.timeout',
          logger,
        ) ?? '60000',
        10,
      ),
      hookEnv: {
        DD_CONTAINER_NAME: container.name,
        DD_CONTAINER_ID: container.id,
        DD_IMAGE_NAME: container.image.name,
        DD_IMAGE_TAG: container.image.tag.value,
        DD_UPDATE_KIND: container.updateKind.kind,
        DD_UPDATE_FROM: container.updateKind.localValue ?? '',
        DD_UPDATE_TO: container.updateKind.remoteValue ?? '',
      },
    };
  }

  isHookFailure(hookResult) {
    return hookResult.exitCode !== 0 || hookResult.timedOut;
  }

  getHookFailureDetails(prefix, hookResult, hookTimeout) {
    if (hookResult.timedOut) {
      return `${prefix} hook timed out after ${hookTimeout}ms`;
    }
    return `${prefix} hook exited with code ${hookResult.exitCode}: ${hookResult.stderr}`;
  }

  createHookFailureError(prefix, hookResult, hookTimeout) {
    return new TriggerPipelineError(
      'hook-execution-failed',
      this.getHookFailureDetails(prefix, hookResult, hookTimeout),
      {
        source: 'HookExecutor',
      },
    );
  }

  async executeHook(command, hookConfig, label, prefix) {
    const hookResult = await this.runHook(command, {
      timeout: hookConfig.hookTimeout,
      env: hookConfig.hookEnv,
      label,
    });

    if (this.isHookFailure(hookResult)) {
      throw this.createHookFailureError(prefix, hookResult, hookConfig.hookTimeout);
    }

    return hookResult;
  }

  async runPreUpdateHook(container, hookConfig, logContainer) {
    if (!hookConfig.hookPre) {
      return;
    }

    let preResult;
    try {
      preResult = await this.executeHook(
        hookConfig.hookPre,
        hookConfig,
        'pre-update',
        'Pre-update',
      );
    } catch (error) {
      if (!TriggerPipelineError.isTriggerPipelineError(error)) {
        throw error;
      }
      this.recordHookAudit('hook-pre-failed', container, 'error', error.message);
      logContainer.warn(error.message);
      if (hookConfig.hookPreAbort) {
        throw error;
      }
      return;
    }

    this.recordHookAudit(
      'hook-pre-success',
      container,
      'success',
      `Pre-update hook completed: ${preResult.stdout}`.trim(),
    );
  }

  async runPostUpdateHook(container, hookConfig, logContainer) {
    if (!hookConfig.hookPost) {
      return;
    }

    let postResult;
    try {
      postResult = await this.executeHook(
        hookConfig.hookPost,
        hookConfig,
        'post-update',
        'Post-update',
      );
    } catch (error) {
      if (!TriggerPipelineError.isTriggerPipelineError(error)) {
        throw error;
      }
      this.recordHookAudit('hook-post-failed', container, 'error', error.message);
      logContainer.warn(error.message);
      return;
    }

    this.recordHookAudit(
      'hook-post-success',
      container,
      'success',
      `Post-update hook completed: ${postResult.stdout}`.trim(),
    );
  }
}

export default HookExecutor;
