export interface SelfUpdateConfiguration {
  dryrun?: boolean;
  helpercompletiontimeout?: number;
}

export interface SelfUpdateLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface SelfUpdateContainerRef {
  image?: {
    name?: string;
  };
  [key: string]: unknown;
}

export interface SelfUpdateContainerSpec {
  Name: string;
  Id: string;
  Config?: {
    Image?: string;
    Env?: unknown[];
  };
  Image?: string;
  HostConfig?: {
    Binds?: string[];
    NetworkMode?: string;
  };
}

export interface SelfUpdateCurrentContainer {
  rename: (options: { name: string }) => Promise<void>;
}

export interface SelfUpdateCreatedContainer {
  inspect: () => Promise<{ Id: string }>;
  remove: (options: { force: boolean }) => Promise<void>;
}

export interface SelfUpdateHelperContainer {
  start: (options?: { abortSignal?: AbortSignal }) => Promise<void>;
  inspect?: () => Promise<{ State?: { Running?: boolean; ExitCode?: number } }>;
  wait?: () => Promise<{ StatusCode?: number }>;
  remove: (options: { force: boolean }) => Promise<void>;
}

export interface SelfUpdateHelperContainerCreateOptions {
  Image: string;
  Cmd: string[];
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: {
    AutoRemove: boolean;
    Binds?: string[];
    NetworkMode?: string;
  };
  name: string;
  abortSignal?: AbortSignal;
}

export interface SelfUpdateDockerApi {
  createContainer: (
    options: SelfUpdateHelperContainerCreateOptions,
  ) => Promise<SelfUpdateHelperContainer>;
  getContainer?: (
    idOrName: string,
  ) => SelfUpdateHelperContainer | Promise<SelfUpdateHelperContainer>;
  getImage?: (imageRef: string) =>
    | {
        inspect?: () => Promise<{ Config?: Record<string, unknown> }>;
      }
    | undefined;
  modem?: {
    host?: string;
    port?: number | string;
    protocol?: string;
    socketPath?: string;
  };
}

export interface SelfUpdateObservedHelperRuntime {
  dockerApi: SelfUpdateDockerApi;
  networkMode: string;
}

export interface SelfUpdateExecutionContext {
  dockerApi: SelfUpdateDockerApi;
  auth: unknown;
  newImage: string;
  currentContainer: SelfUpdateCurrentContainer;
  currentContainerSpec: SelfUpdateContainerSpec;
}

export interface SelfUpdateRuntimeConfigManager {
  getCloneRuntimeConfigOptions: (
    dockerApi: SelfUpdateDockerApi,
    currentContainerSpec: SelfUpdateContainerSpec,
    newImage: string,
    logContainer: SelfUpdateLogger,
  ) => Promise<unknown>;
}
