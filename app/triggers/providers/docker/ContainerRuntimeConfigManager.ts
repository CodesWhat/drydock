// @ts-nocheck

const RUNTIME_PROCESS_FIELDS = ['Entrypoint', 'Cmd'];
const RUNTIME_ORIGIN_EXPLICIT = 'explicit';
const RUNTIME_ORIGIN_INHERITED = 'inherited';
const RUNTIME_ORIGIN_UNKNOWN = 'unknown';
const RUNTIME_FIELD_ORIGIN_LABELS = {
  Entrypoint: {
    dd: 'dd.runtime.entrypoint.origin',
    wud: 'wud.runtime.entrypoint.origin',
  },
  Cmd: {
    dd: 'dd.runtime.cmd.origin',
    wud: 'wud.runtime.cmd.origin',
  },
};

class ContainerRuntimeConfigManager {
  getPreferredLabelValue;

  getLogger;

  constructor(options = {}) {
    this.getPreferredLabelValue = options.getPreferredLabelValue;
    this.getLogger = options.getLogger || (() => undefined);
  }

  sanitizeEndpointConfig(endpointConfig, currentContainerId) {
    if (!endpointConfig) {
      return {};
    }

    const sanitizedEndpointConfig: Record<string, any> = {};

    if (endpointConfig.IPAMConfig) {
      sanitizedEndpointConfig.IPAMConfig = endpointConfig.IPAMConfig;
    }
    if (endpointConfig.Links) {
      sanitizedEndpointConfig.Links = endpointConfig.Links;
    }
    if (endpointConfig.DriverOpts) {
      sanitizedEndpointConfig.DriverOpts = endpointConfig.DriverOpts;
    }
    if (endpointConfig.MacAddress) {
      sanitizedEndpointConfig.MacAddress = endpointConfig.MacAddress;
    }
    if (endpointConfig.Aliases?.length > 0) {
      sanitizedEndpointConfig.Aliases = endpointConfig.Aliases.filter(
        (alias) => !currentContainerId.startsWith(alias),
      );
    }

    return sanitizedEndpointConfig;
  }

  getPrimaryNetworkName(containerToCreate, networkNames) {
    const networkMode = containerToCreate?.HostConfig?.NetworkMode;
    if (networkMode && networkNames.includes(networkMode)) {
      return networkMode;
    }
    return networkNames[0];
  }

  normalizeContainerProcessArgs(processArgs) {
    if (processArgs === undefined || processArgs === null) {
      return undefined;
    }
    if (Array.isArray(processArgs)) {
      return processArgs.map((arg) => String(arg));
    }
    return [String(processArgs)];
  }

  areContainerProcessArgsEqual(left, right) {
    const leftNormalized = this.normalizeContainerProcessArgs(left);
    const rightNormalized = this.normalizeContainerProcessArgs(right);

    if (leftNormalized === undefined && rightNormalized === undefined) {
      return true;
    }
    if (leftNormalized === undefined || rightNormalized === undefined) {
      return false;
    }
    if (leftNormalized.length !== rightNormalized.length) {
      return false;
    }
    return leftNormalized.every((value, index) => value === rightNormalized[index]);
  }

  normalizeRuntimeFieldOrigin(origin) {
    const normalizedOrigin = String(origin || '').toLowerCase();
    if (
      normalizedOrigin === RUNTIME_ORIGIN_EXPLICIT ||
      normalizedOrigin === RUNTIME_ORIGIN_INHERITED
    ) {
      return normalizedOrigin;
    }
    return RUNTIME_ORIGIN_UNKNOWN;
  }

  getRuntimeFieldOrigin(containerConfig, runtimeField) {
    const runtimeOriginLabels = RUNTIME_FIELD_ORIGIN_LABELS[runtimeField];
    const originFromLabel = this.getPreferredLabelValue(
      containerConfig?.Labels,
      runtimeOriginLabels.dd,
      runtimeOriginLabels.wud,
      this.getLogger(),
    );
    const normalizedOrigin = this.normalizeRuntimeFieldOrigin(originFromLabel);
    if (normalizedOrigin !== RUNTIME_ORIGIN_UNKNOWN) {
      return normalizedOrigin;
    }

    if (containerConfig?.[runtimeField] === undefined) {
      return RUNTIME_ORIGIN_INHERITED;
    }
    return RUNTIME_ORIGIN_UNKNOWN;
  }

  getRuntimeFieldOrigins(containerConfig) {
    return RUNTIME_PROCESS_FIELDS.reduce((runtimeFieldOrigins, runtimeField) => {
      runtimeFieldOrigins[runtimeField] = this.getRuntimeFieldOrigin(containerConfig, runtimeField);
      return runtimeFieldOrigins;
    }, {});
  }

  annotateClonedRuntimeFieldOrigins(containerConfig, runtimeFieldOrigins, targetImageConfig) {
    const labels = { ...(containerConfig?.Labels || {}) };

    for (const runtimeField of RUNTIME_PROCESS_FIELDS) {
      const runtimeValue = containerConfig?.[runtimeField];
      let nextRuntimeOrigin = RUNTIME_ORIGIN_INHERITED;

      if (runtimeValue !== undefined) {
        const currentRuntimeOrigin = this.normalizeRuntimeFieldOrigin(
          runtimeFieldOrigins?.[runtimeField],
        );
        if (currentRuntimeOrigin === RUNTIME_ORIGIN_INHERITED) {
          nextRuntimeOrigin = this.areContainerProcessArgsEqual(
            runtimeValue,
            targetImageConfig?.[runtimeField],
          )
            ? RUNTIME_ORIGIN_INHERITED
            : RUNTIME_ORIGIN_EXPLICIT;
        } else {
          nextRuntimeOrigin = RUNTIME_ORIGIN_EXPLICIT;
        }
      }

      labels[RUNTIME_FIELD_ORIGIN_LABELS[runtimeField].dd] = nextRuntimeOrigin;
    }

    return {
      ...(containerConfig || {}),
      Labels: labels,
    };
  }

  buildCloneRuntimeConfigOptions(runtimeOptionsOrLogContainer) {
    if (!runtimeOptionsOrLogContainer) {
      return {};
    }

    const hasRuntimeConfigOptions =
      Object.hasOwn(runtimeOptionsOrLogContainer, 'sourceImageConfig') ||
      Object.hasOwn(runtimeOptionsOrLogContainer, 'targetImageConfig') ||
      Object.hasOwn(runtimeOptionsOrLogContainer, 'runtimeFieldOrigins') ||
      Object.hasOwn(runtimeOptionsOrLogContainer, 'logContainer');

    if (hasRuntimeConfigOptions) {
      return runtimeOptionsOrLogContainer;
    }

    // Backward compatibility for existing callsites that passed logContainer
    return { logContainer: runtimeOptionsOrLogContainer };
  }

  sanitizeClonedRuntimeConfig(
    containerConfig,
    sourceImageConfig,
    targetImageConfig,
    runtimeFieldOrigins,
    logContainer,
  ) {
    const sanitizedConfig = { ...(containerConfig || {}) };

    for (const runtimeField of RUNTIME_PROCESS_FIELDS) {
      const clonedValue = containerConfig?.[runtimeField];
      if (clonedValue === undefined) {
        continue;
      }

      const runtimeOrigin = this.normalizeRuntimeFieldOrigin(runtimeFieldOrigins?.[runtimeField]);
      const inheritedFromSource = this.areContainerProcessArgsEqual(
        clonedValue,
        sourceImageConfig?.[runtimeField],
      );
      if (runtimeOrigin !== RUNTIME_ORIGIN_INHERITED) {
        if (runtimeOrigin === RUNTIME_ORIGIN_UNKNOWN && inheritedFromSource) {
          logContainer?.debug?.(
            `Preserving ${runtimeField} because runtime origin is unknown; avoiding stale-default cleanup to prevent dropping explicit pins`,
          );
        }
        continue;
      }

      if (!inheritedFromSource) {
        continue;
      }

      const matchesTargetDefault = this.areContainerProcessArgsEqual(
        clonedValue,
        targetImageConfig?.[runtimeField],
      );
      if (matchesTargetDefault) {
        continue;
      }

      delete sanitizedConfig[runtimeField];
      logContainer?.info?.(
        `Dropping stale ${runtimeField} from cloned container spec so target image defaults can be used`,
      );
    }

    return sanitizedConfig;
  }

  async inspectImageConfig(dockerApi, imageRef, logContainer) {
    if (!dockerApi?.getImage || !imageRef) {
      return undefined;
    }

    try {
      const image = await dockerApi.getImage(imageRef);
      if (!image?.inspect) {
        return undefined;
      }
      const imageSpec = await image.inspect();
      return imageSpec?.Config;
    } catch (e) {
      logContainer?.debug?.(
        `Unable to inspect image ${imageRef} for runtime defaults (${e.message})`,
      );
      return undefined;
    }
  }

  async getCloneRuntimeConfigOptions(dockerApi, currentContainerSpec, newImage, logContainer) {
    const sourceImageRef = currentContainerSpec?.Config?.Image ?? currentContainerSpec?.Image;
    const [sourceImageConfig, targetImageConfig] = await Promise.all([
      this.inspectImageConfig(dockerApi, sourceImageRef, logContainer),
      this.inspectImageConfig(dockerApi, newImage, logContainer),
    ]);

    return {
      sourceImageConfig,
      targetImageConfig,
      runtimeFieldOrigins: this.getRuntimeFieldOrigins(currentContainerSpec?.Config),
      logContainer,
    };
  }

  isRuntimeConfigCompatibilityError(errorMessage) {
    if (typeof errorMessage !== 'string') {
      return false;
    }

    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes('exec:') &&
      (normalizedMessage.includes('no such file or directory') ||
        normalizedMessage.includes('executable file not found') ||
        normalizedMessage.includes('permission denied'))
    );
  }

  buildRuntimeConfigCompatibilityError(
    error,
    containerName,
    currentContainerSpec,
    targetImage,
    rollbackSucceeded,
  ) {
    const originalMessage = error?.message ?? String(error);
    if (!this.isRuntimeConfigCompatibilityError(originalMessage)) {
      return undefined;
    }

    const sourceImage =
      currentContainerSpec?.Config?.Image ?? currentContainerSpec?.Image ?? 'unknown';
    const rollbackStatus = rollbackSucceeded
      ? 'Rollback completed.'
      : 'Rollback attempted but did not fully complete.';

    return new Error(
      `Container ${containerName} runtime command is incompatible with target image ${targetImage} (source image: ${sourceImage}). ${rollbackStatus} Review Entrypoint/Cmd overrides and retry. Original error: ${originalMessage}`,
    );
  }
}

export default ContainerRuntimeConfigManager;
