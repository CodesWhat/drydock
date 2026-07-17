import { parseEnvNonNegativeInteger } from '../../../util/parse.js';
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
  recordHookAudit: (
    action: string,
    container: HookContainer,
    status: 'success' | 'error',
    details: string,
  ) => void;
};

type HookExecutorConstructorOptions = Omit<
  HookExecutorDependencies,
  'getLogger' | 'recordHookAudit'
> & {
  getLogger?: HookExecutorDependencies['getLogger'];
  recordHookAudit?: HookExecutorDependencies['recordHookAudit'];
};

const REQUIRED_HOOK_EXECUTOR_DEPENDENCY_KEYS = ['runHook', 'getPreferredLabelValue'] as const;
const DEFAULT_HOOK_TIMEOUT_MS = 60000;

/**
 * Shell-unsafe characters that must not appear unescaped in env values
 * passed to a /bin/sh -c invocation. Matches the set used by the Command
 * trigger provider for consistency.
 */
const HOOK_ENV_UNSAFE_CHARACTERS = new Set(['`', '$', ';', '&', '|', '<', '>', '(', ')']);
const HOOK_ENV_DELETE_CODE_POINT = 0x7f;

/**
 * Sanitize a string value before it is placed in the hook environment.
 * Replaces shell-metacharacters, control codes, and DEL with '_' so that
 * registry-controlled data (image name, tag, update digest) cannot inject
 * commands into hook scripts that expand the variables unquoted.
 *
 * Uses the same character set as Command trigger's sanitizeCommandEnvString.
 */
function sanitizeHookEnvValue(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return '';
  }
  return Array.from(value)
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

  recordHookAudit: HookExecutorDependencies['recordHookAudit'];

  constructor(options: HookExecutorConstructorOptions) {
    const dependencies = resolveFunctionDependencies<HookExecutorDependencies>(options, {
      requiredKeys: REQUIRED_HOOK_EXECUTOR_DEPENDENCY_KEYS,
      defaults: {
        getLogger: () => undefined,
        recordHookAudit: () => undefined,
      },
      componentName: 'HookExecutor',
    });
    Object.assign(this, dependencies);
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
