export interface SelfUpdateConfiguration {
  dryrun?: boolean;
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
  };
  Image?: string;
  HostConfig?: {
    Binds?: string[];
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
  start: () => Promise<void>;
}

export interface SelfUpdateHelperContainerCreateOptions {
  Image: string;
  Cmd: string[];
  Env: string[];
  Labels: Record<string, string>;
  HostConfig: {
    AutoRemove: boolean;
    Binds: string[];
  };
  name: string;
}

export interface SelfUpdateDockerApi {
  createContainer: (
    options: SelfUpdateHelperContainerCreateOptions,
  ) => Promise<SelfUpdateHelperContainer>;
  getImage?: (imageRef: string) =>
    | {
        inspect?: () => Promise<{ Config?: Record<string, unknown> }>;
      }
    | undefined;
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
