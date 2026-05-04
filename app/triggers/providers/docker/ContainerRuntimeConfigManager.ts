import { resolveFunctionDependencies } from './dependency-constructor.js';

const RUNTIME_PROCESS_FIELDS = ['Entrypoint', 'Cmd'] as const;
const RUNTIME_ORIGIN_EXPLICIT = 'explicit';
const RUNTIME_ORIGIN_INHERITED = 'inherited';
const RUNTIME_ORIGIN_UNKNOWN = 'unknown';
type RuntimeProcessField = (typeof RUNTIME_PROCESS_FIELDS)[number];
type RuntimeFieldOrigin =
  | typeof RUNTIME_ORIGIN_EXPLICIT
  | typeof RUNTIME_ORIGIN_INHERITED
  | typeof RUNTIME_ORIGIN_UNKNOWN;
type RuntimeFieldOrigins = Partial<Record<RuntimeProcessField, RuntimeFieldOrigin>>;

type RuntimeConfigLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
  child?: (bindings?: Record<string, unknown>) => RuntimeConfigLogger | undefined;
};

type RuntimeConfigObject = {
  Entrypoint?: unknown;
  Cmd?: unknown;
  Image?: string;
  Labels?: Record<string, string>;
  [key: string]: unknown;
};

type RuntimeConfigOptions = {
  sourceImageConfig?: RuntimeConfigObject;
  targetImageConfig?: RuntimeConfigObject;
  runtimeFieldOrigins?: RuntimeFieldOrigins;
  logContainer?: RuntimeConfigLogger;
};

type ClonedRuntimeFieldEvaluationContext = Pick<
  RuntimeConfigOptions,
  'sourceImageConfig' | 'targetImageConfig' | 'runtimeFieldOrigins' | 'logContainer'
>;

type RuntimeConfigManagerDependencies = {
  getPreferredLabelValue: (
    labels: Record<string, string> | undefined,
    ddKey: string,
    wudKey: string,
    logger?: RuntimeConfigLogger,
  ) => string | undefined;
  getLogger: () => RuntimeConfigLogger | undefined;
};

type RuntimeConfigManagerConstructorOptions = Omit<
  RuntimeConfigManagerDependencies,
  'getLogger'
> & {
  getLogger?: RuntimeConfigManagerDependencies['getLogger'];
};

const REQUIRED_RUNTIME_CONFIG_MANAGER_DEPENDENCY_KEYS = ['getPreferredLabelValue'] as const;

type EndpointConfig = {
  IPAMConfig?: unknown;
  Links?: unknown;
  DriverOpts?: unknown;
  MacAddress?: unknown;
  Aliases?: string[];
  [key: string]: unknown;
};

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

function isRuntimeConfigOptions(
  runtimeOptionsOrLogContainer: RuntimeConfigOptions | RuntimeConfigLogger | undefined,
): runtimeOptionsOrLogContainer is RuntimeConfigOptions {
  if (!runtimeOptionsOrLogContainer) {
    return false;
  }

  return (
    Object.hasOwn(runtimeOptionsOrLogContainer, 'sourceImageConfig') ||
    Object.hasOwn(runtimeOptionsOrLogContainer, 'targetImageConfig') ||
    Object.hasOwn(runtimeOptionsOrLogContainer, 'runtimeFieldOrigins') ||
    Object.hasOwn(runtimeOptionsOrLogContainer, 'logContainer')
  );
}

class ContainerRuntimeConfigManager {
  getPreferredLabelValue: RuntimeConfigManagerDependencies['getPreferredLabelValue'];

  getLogger: RuntimeConfigManagerDependencies['getLogger'];

  constructor(options: RuntimeConfigManagerConstructorOptions) {
    const dependencies = resolveFunctionDependencies<RuntimeConfigManagerDependencies>(options, {
      requiredKeys: REQUIRED_RUNTIME_CONFIG_MANAGER_DEPENDENCY_KEYS,
      defaults: {
        getLogger: () => undefined,
      },
      componentName: 'ContainerRuntimeConfigManager',
    });
    Object.assign(this, dependencies);
  }

  sanitizeEndpointConfig(
    endpointConfig: EndpointConfig | null | undefined,
    currentContainerId: string,
  ) {
    if (!endpointConfig) {
      return {};
    }

    const sanitizedEndpointConfig: EndpointConfig = {};

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

  getPrimaryNetworkName(
    containerToCreate: { HostConfig?: { NetworkMode?: string } } | undefined,
    networkNames: string[],
  ) {
    const networkMode = containerToCreate?.HostConfig?.NetworkMode;
    if (networkMode && networkNames.includes(networkMode)) {
      return networkMode;
    }
    return networkNames[0];
  }

  normalizeContainerProcessArgs(processArgs: unknown) {
    if (processArgs === undefined || processArgs === null) {
      return undefined;
    }
    if (Array.isArray(processArgs)) {
      return processArgs.map((arg) => String(arg));
    }
    return [String(processArgs)];
  }

  areContainerProcessArgsEqual(left: unknown, right: unknown) {
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

  normalizeRuntimeFieldOrigin(origin: unknown): RuntimeFieldOrigin {
    const normalizedOrigin = String(origin || '').toLowerCase();
    if (
      normalizedOrigin === RUNTIME_ORIGIN_EXPLICIT ||
      normalizedOrigin === RUNTIME_ORIGIN_INHERITED
    ) {
      return normalizedOrigin;
    }
    return RUNTIME_ORIGIN_UNKNOWN;
  }

  getRuntimeFieldOrigin(
    containerConfig: RuntimeConfigObject | undefined,
    runtimeField: RuntimeProcessField,
  ) {
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

  getRuntimeFieldOrigins(containerConfig: RuntimeConfigObject | undefined): RuntimeFieldOrigins {
    return RUNTIME_PROCESS_FIELDS.reduce<RuntimeFieldOrigins>(
      (runtimeFieldOrigins, runtimeField) => {
        runtimeFieldOrigins[runtimeField] = this.getRuntimeFieldOrigin(
          containerConfig,
          runtimeField,
        );
        return runtimeFieldOrigins;
      },
      {},
    );
  }

  annotateClonedRuntimeFieldOrigins(
    containerConfig: RuntimeConfigObject | undefined,
    runtimeFieldOrigins: RuntimeFieldOrigins | undefined,
    targetImageConfig: RuntimeConfigObject | undefined,
  ) {
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

  buildCloneRuntimeConfigOptions(
    runtimeOptionsOrLogContainer: RuntimeConfigOptions | RuntimeConfigLogger | undefined,
  ): RuntimeConfigOptions {
    if (isRuntimeConfigOptions(runtimeOptionsOrLogContainer)) {
      return runtimeOptionsOrLogContainer;
    }

    if (!runtimeOptionsOrLogContainer) {
      return {};
    }

    // Backward compatibility for existing callsites that passed logContainer
    return { logContainer: runtimeOptionsOrLogContainer };
  }

  shouldDropClonedRuntimeField(
    runtimeField: RuntimeProcessField,
    clonedValue: unknown,
    evaluationContext: ClonedRuntimeFieldEvaluationContext,
  ) {
    if (clonedValue === undefined) {
      return false;
    }

    const { sourceImageConfig, targetImageConfig, runtimeFieldOrigins, logContainer } =
      evaluationContext;
    const runtimeOrigin = this.normalizeRuntimeFieldOrigin(runtimeFieldOrigins?.[runtimeField]);
    const inheritedFromSource = this.areContainerProcessArgsEqual(
      clonedValue,
      sourceImageConfig?.[runtimeField],
    );
    const sourceImageKnown = sourceImageConfig !== undefined;
    if (
      !this.isInheritedRuntimeField(
        runtimeField,
        runtimeOrigin,
        inheritedFromSource,
        sourceImageKnown,
        logContainer,
      )
    ) {
      return false;
    }

    return !this.areContainerProcessArgsEqual(clonedValue, targetImageConfig?.[runtimeField]);
  }

  isInheritedRuntimeField(
    runtimeField: RuntimeProcessField,
    runtimeOrigin: RuntimeFieldOrigin,
    inheritedFromSource: boolean,
    sourceImageKnown: boolean,
    logContainer: RuntimeConfigLogger | undefined,
  ) {
    if (runtimeOrigin === RUNTIME_ORIGIN_INHERITED) {
      return inheritedFromSource;
    }

    if (runtimeOrigin === RUNTIME_ORIGIN_UNKNOWN && inheritedFromSource) {
      if (sourceImageKnown) {
        logContainer?.debug?.(
          `Treating ${runtimeField} as inherited (origin unknown but matches source image default and source image is known)`,
        );
        return true;
      }
      logContainer?.debug?.(
        `Preserving ${runtimeField}: origin unknown and source image unavailable`,
      );
    }

    return false;
  }

  sanitizeClonedRuntimeConfig(
    containerConfig: RuntimeConfigObject | undefined,
    sourceImageConfig: RuntimeConfigObject | undefined,
    targetImageConfig: RuntimeConfigObject | undefined,
    runtimeFieldOrigins: RuntimeFieldOrigins | undefined,
    logContainer: RuntimeConfigLogger | undefined,
  ) {
    const sanitizedConfig = { ...(containerConfig || {}) };
    const evaluationContext: ClonedRuntimeFieldEvaluationContext = {
      sourceImageConfig,
      targetImageConfig,
      runtimeFieldOrigins,
      logContainer,
    };

    for (const runtimeField of RUNTIME_PROCESS_FIELDS) {
      const clonedValue = containerConfig?.[runtimeField];
      if (!this.shouldDropClonedRuntimeField(runtimeField, clonedValue, evaluationContext)) {
        continue;
      }

      delete sanitizedConfig[runtimeField];
      logContainer?.info?.(
        `Dropping stale ${runtimeField} from cloned container spec so target image defaults can be used`,
      );
    }

    return sanitizedConfig;
  }

  async inspectImageConfig(
    dockerApi:
      | {
          getImage?: (imageRef: string) =>
            | {
                inspect?: () => Promise<{ Config?: RuntimeConfigObject }>;
              }
            | undefined;
        }
      | undefined,
    imageRef: string | undefined,
    logContainer: RuntimeConfigLogger | undefined,
  ) {
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
    } catch (e: unknown) {
      logContainer?.debug?.(
        `Unable to inspect image ${imageRef} for runtime defaults (${String(
          (e as Error)?.message ?? e,
        )})`,
      );
      return undefined;
    }
  }

  async getCloneRuntimeConfigOptions(
    dockerApi:
      | {
          getImage?: (imageRef: string) =>
            | {
                inspect?: () => Promise<{ Config?: RuntimeConfigObject }>;
              }
            | undefined;
        }
      | undefined,
    currentContainerSpec: { Config?: { Image?: string }; Image?: string } | undefined,
    newImage: string,
    logContainer: RuntimeConfigLogger | undefined,
  ): Promise<RuntimeConfigOptions> {
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

  isRuntimeConfigCompatibilityError(errorMessage: unknown): boolean {
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
    error: unknown,
    containerName: string,
    currentContainerSpec: { Config?: { Image?: string }; Image?: string } | undefined,
    targetImage: string,
    rollbackSucceeded: boolean,
  ) {
    const originalMessage = String((error as Error)?.message ?? error);
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
