const POST_START_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type PostStartExecutorLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type PostStartHook =
  | string
  | {
      command?: string | string[];
      user?: string;
      working_dir?: string;
      privileged?: boolean;
      environment?: string[] | Record<string, unknown>;
    };

type PostStartExecStream = {
  once?: (event: string, callback: (error?: unknown) => void) => void;
  removeListener: (event: string, callback: (error?: unknown) => void) => void;
  resume?: () => void;
};

type PostStartExecResult = {
  ExitCode?: number;
};

type DockerContainerLike = {
  inspect: () => Promise<{
    State?: {
      Running?: boolean;
    };
  }>;
  exec: (options: unknown) => Promise<{
    start: (options: { Detach: boolean; Tty: boolean }) => Promise<PostStartExecStream>;
    inspect: () => Promise<PostStartExecResult>;
  }>;
};

type DockerApiLike = {
  getContainer: (containerName: string) => DockerContainerLike;
};

export interface PostStartExecutorOptions {
  getLog?: () => PostStartExecutorLog | undefined;
  getWatcher: (container: unknown) => unknown;
  isDryRun?: () => boolean;
  getDockerApiFromWatcher?: (watcher: unknown) => DockerApiLike | undefined;
}

function defaultGetDockerApiFromWatcher(watcher: unknown): DockerApiLike | undefined {
  if (!watcher || typeof watcher !== 'object') {
    return undefined;
  }
  const dockerApi = (watcher as { dockerApi?: unknown }).dockerApi;
  if (!dockerApi || typeof dockerApi !== 'object') {
    return undefined;
  }
  const maybeDockerApi = dockerApi as Partial<DockerApiLike>;
  if (typeof maybeDockerApi.getContainer !== 'function') {
    return undefined;
  }
  return maybeDockerApi as DockerApiLike;
}

export function normalizePostStartHooks(postStart: unknown): PostStartHook[] {
  if (!postStart) {
    return [];
  }
  if (Array.isArray(postStart)) {
    return postStart as PostStartHook[];
  }
  return [postStart as PostStartHook];
}

function normalizePostStartCommand(command: string | string[]) {
  if (Array.isArray(command)) {
    return command.map((value) => `${value}`);
  }
  return ['sh', '-c', `${command}`];
}

export function normalizePostStartEnvironmentValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return `${value}`;
}

function validatePostStartEnvironmentKey(key: string) {
  if (!POST_START_ENVIRONMENT_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid compose post_start environment variable key "${key}"`);
  }
}

function normalizePostStartEnvironment(
  environment: string[] | Record<string, unknown> | undefined,
) {
  if (!environment) {
    return undefined;
  }
  if (Array.isArray(environment)) {
    return environment.map((value) => {
      const normalized = `${value}`;
      const separatorIndex = normalized.indexOf('=');
      const key = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized;
      validatePostStartEnvironmentKey(key);
      return normalized;
    });
  }
  return Object.entries(environment).map(([key, value]) => {
    validatePostStartEnvironmentKey(key);
    return `${key}=${normalizePostStartEnvironmentValue(value)}`;
  });
}

class PostStartExecutor {
  private readonly getLog: () => PostStartExecutorLog | undefined;
  private readonly getWatcher: (container: unknown) => unknown;
  private readonly isDryRun: () => boolean;
  private readonly getDockerApiFromWatcher: (watcher: unknown) => DockerApiLike | undefined;

  constructor(options: PostStartExecutorOptions) {
    if (typeof options?.getWatcher !== 'function') {
      throw new TypeError('PostStartExecutor requires dependency "getWatcher"');
    }

    this.getLog = options.getLog || (() => undefined);
    this.getWatcher = options.getWatcher;
    this.isDryRun = options.isDryRun || (() => false);
    this.getDockerApiFromWatcher =
      options.getDockerApiFromWatcher || defaultGetDockerApiFromWatcher;
  }

  async resolvePostStartHooksContainer(container: { name?: string }, serviceKey: string) {
    const watcher = this.getWatcher(container);
    const dockerApi = this.getDockerApiFromWatcher(watcher);
    if (!dockerApi) {
      this.getLog()?.warn?.(
        `Skip compose post_start hooks for ${container.name} (${serviceKey}) because watcher Docker API is unavailable`,
      );
      return null;
    }
    const containerToUpdate = dockerApi.getContainer(`${container.name}`);
    const containerState = await containerToUpdate.inspect();
    if (!containerState?.State?.Running) {
      this.getLog()?.info?.(
        `Skip compose post_start hooks for ${container.name} (${serviceKey}) because container is not running`,
      );
      return null;
    }
    return containerToUpdate;
  }

  normalizePostStartHookConfiguration(
    hook: PostStartHook,
    containerName: string,
    serviceKey: string,
  ) {
    const hookConfiguration = typeof hook === 'string' ? { command: hook } : hook;
    if (hookConfiguration?.command) {
      return hookConfiguration;
    }

    this.getLog()?.warn?.(
      `Skip invalid compose post_start hook for ${containerName} (${serviceKey}) because command is missing`,
    );
    return null;
  }

  buildPostStartHookExecOptions(hookConfiguration: {
    command: string | string[];
    user?: string;
    working_dir?: string;
    privileged?: boolean;
    environment?: string[] | Record<string, unknown>;
  }) {
    return {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: normalizePostStartCommand(hookConfiguration.command),
      User: hookConfiguration.user,
      WorkingDir: hookConfiguration.working_dir,
      Privileged: hookConfiguration.privileged,
      Env: normalizePostStartEnvironment(hookConfiguration.environment),
    };
  }

  async waitForPostStartHookExecStream(execStream: PostStartExecStream): Promise<void> {
    await new Promise((resolve, reject) => {
      if (!execStream?.once) {
        resolve(undefined);
        return;
      }
      const onError = (e: unknown) => {
        execStream.removeListener('end', onDone);
        execStream.removeListener('close', onDone);
        reject(e);
      };
      const onDone = () => {
        execStream.removeListener('end', onDone);
        execStream.removeListener('close', onDone);
        execStream.removeListener('error', onError);
        resolve(undefined);
      };
      execStream.once('end', onDone);
      execStream.once('close', onDone);
      execStream.once('error', onError);
    });
  }

  ensurePostStartHookExecSucceeded(
    execResult: PostStartExecResult,
    containerName: string,
    serviceKey: string,
  ): void {
    if (execResult.ExitCode === 0) {
      return;
    }
    throw new Error(
      `Compose post_start hook failed for ${containerName} (${serviceKey}) with exit code ${execResult.ExitCode}`,
    );
  }

  async runPostStartHook(
    containerToUpdate: DockerContainerLike,
    container: { name?: string },
    serviceKey: string,
    hook: PostStartHook,
  ): Promise<void> {
    const hookConfiguration = this.normalizePostStartHookConfiguration(
      hook,
      `${container.name}`,
      serviceKey,
    );
    if (!hookConfiguration) {
      return;
    }

    const execOptions = this.buildPostStartHookExecOptions(hookConfiguration as any);
    this.getLog()?.info?.(`Run compose post_start hook for ${container.name} (${serviceKey})`);
    const exec = await containerToUpdate.exec(execOptions);
    const execStream = await exec.start({
      Detach: false,
      Tty: false,
    });
    if (execStream?.resume) {
      execStream.resume();
    }
    await this.waitForPostStartHookExecStream(execStream);
    const execResult = await exec.inspect();
    this.ensurePostStartHookExecSucceeded(execResult, `${container.name}`, serviceKey);
  }

  async runServicePostStartHooks(
    container: { name?: string },
    serviceKey: string,
    service: { post_start?: unknown } | null | undefined,
  ) {
    if (this.isDryRun() || !service?.post_start) {
      return;
    }

    const hooks = normalizePostStartHooks(service.post_start);
    if (hooks.length === 0) {
      return;
    }

    const containerToUpdate = await this.resolvePostStartHooksContainer(container, serviceKey);
    if (!containerToUpdate) {
      return;
    }

    for (const hook of hooks) {
      await this.runPostStartHook(containerToUpdate, container, serviceKey, hook);
    }
  }
}

export default PostStartExecutor;
