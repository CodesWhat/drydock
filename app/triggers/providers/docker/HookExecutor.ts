import { parseEnvNonNegativeInteger } from '../../../util/parse.js';
import { isHooksExecutionEnabled, isImageHookLabelsAllowed } from '../../hooks/hook-flags.js';
import { isHookLabelKey } from '../../hooks/hook-labels.js';
import { resolveFunctionDependencies } from './dependency-constructor.js';
import TriggerPipelineError from './TriggerPipelineError.js';

type HookExecutorLogger = {
  child?: (bindings?: Record<string, unknown>) => unknown;
  warn?: (message: string) => void;
};

type HookContainer = {
  name: string;
  id: string;
  image: {
    name: string;
    tag: { value: string };
  };
  updateKind: {
    kind: string;
    localValue?: string | null;
    remoteValue?: string | null;
  };
  labels?: Record<string, string>;
};

type HookProvenanceContainerSpec = {
  Image?: string;
};

type HookProvenanceContext = {
  dockerApi?: unknown;
  currentContainerSpec?: HookProvenanceContainerSpec | null;
};

type HookResult = {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

type HookConfig = {
  hookPre?: string;
  hookPost?: string;
  hookPreAbort: boolean;
  hookTimeout: number;
  hookEnv: Record<string, string>;
};

type HookExecutorDependencies = {
  runHook: (
    command: string,
    options: { timeout: number; env: Record<string, string>; label: string },
  ) => Promise<HookResult>;
  getPreferredLabelValue: (
    labels: Record<string, string> | undefined,
    ddKey: string,
    logger?: unknown,
  ) => string | undefined;
  getLogger: () => HookExecutorLogger | undefined;
  inspectImageConfig: (
    dockerApi: unknown,
    imageRef: string | undefined,
    logger: unknown,
  ) => Promise<{ Labels?: Record<string, string> | null } | undefined>;
  inspectContainerSpec: (
    dockerApi: unknown,
    container: HookContainer,
  ) => Promise<HookProvenanceContainerSpec | undefined>;
  recordHookAudit: (
    action: string,
    container: HookContainer,
    status: 'success' | 'error',
    details: string,
  ) => void;
};

type HookExecutorConstructorOptions = Omit<
  HookExecutorDependencies,
  'getLogger' | 'recordHookAudit' | 'inspectImageConfig' | 'inspectContainerSpec'
> & {
  getLogger?: HookExecutorDependencies['getLogger'];
  inspectImageConfig?: HookExecutorDependencies['inspectImageConfig'];
  inspectContainerSpec?: HookExecutorDependencies['inspectContainerSpec'];
  recordHookAudit?: HookExecutorDependencies['recordHookAudit'];
};

const REQUIRED_HOOK_EXECUTOR_DEPENDENCY_KEYS = ['runHook', 'getPreferredLabelValue'] as const;
const DEFAULT_HOOK_TIMEOUT_MS = 60000;
const HOOK_COMMAND_LABEL_KEYS = new Set(['dd.hook.pre', 'dd.hook.post']);

/**
 * Shell-unsafe characters that must not appear unescaped in env values
 * passed to a /bin/sh -c invocation. Matches the set used by the Command
 * trigger provider for consistency.
 */
const HOOK_ENV_UNSAFE_CHARACTERS = new Set([
  '`',
  '$',
  ';',
  '&',
  '|',
  '<',
  '>',
  '(',
  ')',
  // Word-splitting and globbing. Hook values are scalars (container name, id,
  // image, tag, digest) that a hook script expands as a single argument, so
  // neither is ever legitimate here.
  ' ',
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '~',
  '\\',
  '"',
  "'",
]);
const HOOK_ENV_DELETE_CODE_POINT = 0x7f;

/**
 * Sanitize a string value before it is placed in the hook environment.
 * Replaces shell-metacharacters, word-splitting and globbing characters,
 * control codes, and DEL with '_', and drops a leading '-' so the value cannot
 * parse as an option, so that registry-controlled data (image name, tag,
 * update digest) cannot inject arguments into hook scripts that expand the
 * variables unquoted.
 *
 * Uses the same character set as Command trigger's sanitizeCommandEnvString.
 */
function sanitizeHookEnvValue(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  const scrubbed = Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (
        codePoint === undefined ||
        codePoint < 0x20 ||
        codePoint === HOOK_ENV_DELETE_CODE_POINT ||
        HOOK_ENV_UNSAFE_CHARACTERS.has(character)
      ) {
        return '_';
      }
      return character;
    })
    .join('');
  return scrubbed.replace(/^-+/u, '');
}

function parseHookTimeout(rawValue: string | undefined): number {
  try {
    const parsedValue = parseEnvNonNegativeInteger(rawValue, 'dd.hook.timeout');
    return parsedValue !== undefined && parsedValue > 0 ? parsedValue : DEFAULT_HOOK_TIMEOUT_MS;
  } catch {
    return DEFAULT_HOOK_TIMEOUT_MS;
  }
}

class HookExecutor {
  runHook: HookExecutorDependencies['runHook'];

  getPreferredLabelValue: HookExecutorDependencies['getPreferredLabelValue'];

  getLogger: HookExecutorDependencies['getLogger'];

  inspectImageConfig: HookExecutorDependencies['inspectImageConfig'];

  inspectContainerSpec: HookExecutorDependencies['inspectContainerSpec'];

  recordHookAudit: HookExecutorDependencies['recordHookAudit'];

  constructor(options: HookExecutorConstructorOptions) {
    const dependencies = resolveFunctionDependencies<HookExecutorDependencies>(options, {
      requiredKeys: REQUIRED_HOOK_EXECUTOR_DEPENDENCY_KEYS,
      defaults: {
        getLogger: () => undefined,
        inspectImageConfig: async () => undefined,
        inspectContainerSpec: async () => undefined,
        recordHookAudit: () => undefined,
      },
      componentName: 'HookExecutor',
    });
    Object.assign(this, dependencies);
  }

  /**
   * Docker merges an image's baked-in labels into the container's label set, so
   * a hook label only counts as the operator's when the container carries it
   * and the image it was created from does not carry the same key and value.
   */
  async resolveHookConfig(
    container: HookContainer,
    context?: HookProvenanceContext,
  ): Promise<HookConfig> {
    const labels = await this.resolveTrustedHookLabels(container, context);
    return this.buildHookConfig(labels === container.labels ? container : { ...container, labels });
  }

  private async resolveTrustedHookLabels(
    container: HookContainer,
    context?: HookProvenanceContext,
  ): Promise<Record<string, string> | undefined> {
    const labels = container.labels;
    if (!isHooksExecutionEnabled() || isImageHookLabelsAllowed() || !labels) {
      return labels;
    }
    const hookKeys = Object.keys(labels).filter(isHookLabelKey);
    if (hookKeys.length === 0) {
      return labels;
    }

    const imageLabels = await this.readImageLabels(container, context);
    if (imageLabels === undefined) {
      if (hookKeys.some((key) => HOOK_COMMAND_LABEL_KEYS.has(key))) {
        throw new TriggerPipelineError(
          'hook-provenance-unverified',
          `Lifecycle hooks for container ${container.name} were not run because hook provenance could not be established (image labels could not be read). Set DD_HOOKS_ALLOW_IMAGE_LABELS=true to trust hook labels baked into images.`,
          { source: 'HookExecutor' },
        );
      }
      return labels;
    }

    const trustedLabels: Record<string, string> = {};
    for (const [key, value] of Object.entries(labels)) {
      if (isHookLabelKey(key) && imageLabels[key] === value) {
        this.getLogger()?.warn?.(
          `Ignoring lifecycle hook label ${key} on container ${container.name}: it comes from the image, not the container. Set DD_HOOKS_ALLOW_IMAGE_LABELS=true to trust image-baked hook labels.`,
        );
        continue;
      }
      trustedLabels[key] = value;
    }
    return trustedLabels;
  }

  private async readImageLabels(
    container: HookContainer,
    context?: HookProvenanceContext,
  ): Promise<Record<string, string> | undefined> {
    try {
      const spec =
        context?.currentContainerSpec ??
        (await this.inspectContainerSpec(context?.dockerApi, container));
      // Image ID only: a tag may have been re-pulled to a different image since
      // the container was created, so it can't establish where labels came from.
      const imageRef = spec?.Image;
      if (!imageRef) {
        return undefined;
      }
      const imageConfig = await this.inspectImageConfig(
        context?.dockerApi,
        imageRef,
        this.getLogger(),
      );
      if (!imageConfig) {
        return undefined;
      }
      return imageConfig.Labels ?? {};
    } catch {
      return undefined;
    }
  }

  buildHookConfig(container: HookContainer): HookConfig {
    const logger = this.getLogger()?.child?.({});
    return {
      hookPre: this.getPreferredLabelValue(container.labels, 'dd.hook.pre', logger),
      hookPost: this.getPreferredLabelValue(container.labels, 'dd.hook.post', logger),
      hookPreAbort:
        (
          this.getPreferredLabelValue(container.labels, 'dd.hook.pre.abort', logger) ?? 'true'
        ).toLowerCase() === 'true',
      hookTimeout: parseHookTimeout(
        this.getPreferredLabelValue(container.labels, 'dd.hook.timeout', logger),
      ),
      hookEnv: {
        DD_CONTAINER_NAME: sanitizeHookEnvValue(container.name),
        DD_CONTAINER_ID: sanitizeHookEnvValue(container.id),
        DD_IMAGE_NAME: sanitizeHookEnvValue(container.image.name),
        DD_IMAGE_TAG: sanitizeHookEnvValue(container.image.tag.value),
        DD_UPDATE_KIND: sanitizeHookEnvValue(container.updateKind.kind),
        DD_UPDATE_FROM: sanitizeHookEnvValue(container.updateKind.localValue ?? ''),
        DD_UPDATE_TO: sanitizeHookEnvValue(container.updateKind.remoteValue ?? ''),
      },
    };
  }

  isHookFailure(hookResult: HookResult): boolean {
    return hookResult.exitCode !== 0 || hookResult.timedOut;
  }

  getHookFailureDetails(prefix: string, hookResult: HookResult, hookTimeout: number): string {
    if (hookResult.timedOut) {
      return `${prefix} hook timed out after ${hookTimeout}ms`;
    }
    return `${prefix} hook exited with code ${hookResult.exitCode}: ${hookResult.stderr}`;
  }

  createHookFailureError(prefix: string, hookResult: HookResult, hookTimeout: number) {
    return new TriggerPipelineError(
      'hook-execution-failed',
      this.getHookFailureDetails(prefix, hookResult, hookTimeout),
      {
        source: 'HookExecutor',
      },
    );
  }

  async executeHook(command: string, hookConfig: HookConfig, label: string, prefix: string) {
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

  async runPreUpdateHook(
    container: HookContainer,
    hookConfig: HookConfig,
    logContainer: { warn: (message: string) => void },
  ) {
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

  async runPostUpdateHook(
    container: HookContainer,
    hookConfig: HookConfig,
    logContainer: { warn: (message: string) => void },
  ) {
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
