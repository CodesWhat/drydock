import Docker from 'dockerode';
import { getSecurityConfiguration } from '../configuration/index.js';
import {
  createScannerAssetManager,
  type ScannerAssetAuditEvent,
  type ScannerAssetManager,
  type ScannerAssetProvider,
  type ScannerAssetProviderId,
} from './assets.js';
import {
  type BackendResolutionConfiguration,
  resolveProviderExecution,
} from './backend-resolution.js';
import { createDockerScannerBackend } from './backends/docker.js';

type ScannerBackend = {
  run(options: {
    image: string;
    args: string[];
    env?: Record<string, string>;
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
  }): Promise<{ stdout: string }>;
  pullImage(
    image: string,
    auth?: { username?: string; password?: string },
    timeoutMs?: number,
  ): Promise<void>;
  inspectImage(image: string): Promise<{ digest: string; version?: string }>;
};

type ProviderCommandSettings = { command?: string; commandExplicit?: boolean };

type ScannerRuntimeConfiguration = BackendResolutionConfiguration & {
  scanner: string;
  backend: string;
  trivy: { workerImage: string; timeout: number } & ProviderCommandSettings;
  grype: { workerImage: string; timeout: number } & ProviderCommandSettings;
  syft: { workerImage: string; timeout: number } & ProviderCommandSettings;
  signature?: {
    verify: boolean;
    cosign: { workerImage: string; timeout: number } & ProviderCommandSettings;
  };
  sbom: { enabled: boolean; generator?: string };
  docker?: {
    socket: string;
    host: string;
    port: number;
    protocol: 'http' | 'https';
    network: string;
    cacheVolumePrefix: string;
    workerMemoryBytes?: number;
  };
};

export interface ScannerWorkerInvocation {
  provider: ScannerAssetProviderId;
  args: string[];
  env?: NodeJS.ProcessEnv | Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

interface CreateScannerRuntimeOptions {
  configuration: ScannerRuntimeConfiguration;
  backends: Partial<Record<ScannerAssetProviderId, ScannerBackend>>;
  audit?: (event: ScannerAssetAuditEvent) => void | Promise<void>;
}

const PROVIDER_ENV_ALLOWLIST: Record<ScannerAssetProviderId, readonly string[]> = {
  trivy: ['TRIVY_USERNAME', 'TRIVY_PASSWORD'],
  grype: ['SYFT_REGISTRY_AUTH_USERNAME', 'SYFT_REGISTRY_AUTH_PASSWORD'],
  syft: ['SYFT_REGISTRY_AUTH_USERNAME', 'SYFT_REGISTRY_AUTH_PASSWORD'],
  cosign: ['COSIGN_REGISTRY_USERNAME', 'COSIGN_REGISTRY_PASSWORD', 'COSIGN_PUBLIC_KEY'],
};

// The cosign worker runs as a non-root user and only /tmp (tmpfs) is writable by it, so the
// sigstore trust root cache lives there instead of the shared cache volume.
const PROVIDER_CACHE_ENV: Record<ScannerAssetProviderId, Record<string, string>> = {
  // TMPDIR points at a per-worker scratch volume (removed with the worker) because the 64 MiB
  // tmpfs cannot hold the Grype database download or Syft/Trivy image layer extraction, and the
  // shared cache volume would keep whatever an interrupted worker leaves behind.
  trivy: { TRIVY_CACHE_DIR: '/cache', TMPDIR: '/scratch' },
  grype: { GRYPE_DB_CACHE_DIR: '/cache', TMPDIR: '/scratch' },
  syft: { SYFT_CACHE_DIR: '/cache', TMPDIR: '/scratch' },
  cosign: { HOME: '/tmp', TUF_ROOT: '/tmp/tuf' },
};

const SUPPORTED_BACKENDS = ['auto', 'command', 'docker', 'remote'];

function getProviderSettings(
  configuration: ScannerRuntimeConfiguration,
  provider: ScannerAssetProviderId,
): { workerImage: string; timeout: number } {
  return provider === 'cosign'
    ? (configuration.signature as NonNullable<ScannerRuntimeConfiguration['signature']>).cosign
    : configuration[provider];
}

function getWorkerImage(
  configuration: ScannerRuntimeConfiguration,
  provider: ScannerAssetProviderId,
): string {
  return getProviderSettings(configuration, provider).workerImage;
}

function getProviderTimeout(
  configuration: ScannerRuntimeConfiguration,
  provider: ScannerAssetProviderId,
): number {
  return getProviderSettings(configuration, provider).timeout;
}

function resolveSbomGenerator(configuration: ScannerRuntimeConfiguration): 'trivy' | 'syft' {
  if (configuration.sbom.generator === 'trivy' || configuration.sbom.generator === 'syft') {
    return configuration.sbom.generator;
  }
  return configuration.scanner === 'grype' ? 'syft' : 'trivy';
}

function selectProviderIds(
  configuration: ScannerRuntimeConfiguration,
  sbomGenerator: 'trivy' | 'syft',
): ScannerAssetProviderId[] {
  const providers = new Set<ScannerAssetProviderId>();
  if (configuration.scanner === 'trivy' || configuration.scanner === 'both') {
    providers.add('trivy');
  }
  if (configuration.scanner === 'grype' || configuration.scanner === 'both') {
    providers.add('grype');
  }
  if (configuration.sbom.enabled) {
    providers.add(sbomGenerator);
  }
  if (configuration.signature?.verify) {
    providers.add('cosign');
  }
  return (['trivy', 'grype', 'syft', 'cosign'] as const).filter(
    (provider) =>
      providers.has(provider) && resolveProviderExecution(provider, configuration) === 'worker',
  );
}

function requireBackend(
  backends: Partial<Record<ScannerAssetProviderId, ScannerBackend>>,
  provider: ScannerAssetProviderId,
): ScannerBackend {
  const backend = backends[provider];
  if (!backend) {
    throw new Error(`Docker scanner backend for ${provider} is not configured`);
  }
  return backend;
}

function filterWorkerEnvironment(
  provider: ScannerAssetProviderId,
  environment: ScannerWorkerInvocation['env'],
): Record<string, string> {
  const filtered = { ...PROVIDER_CACHE_ENV[provider] };
  for (const key of PROVIDER_ENV_ALLOWLIST[provider]) {
    const value = environment?.[key];
    if (typeof value === 'string') {
      filtered[key] = value;
    }
  }
  return filtered;
}

function getWarmupArgs(provider: ScannerAssetProviderId, timeout: number): string[] | undefined {
  if (provider === 'trivy') {
    return [
      'image',
      '--download-db-only',
      '--timeout',
      `${Math.max(1, Math.ceil(timeout / 1000))}s`,
    ];
  }
  return provider === 'grype' ? ['db', 'update'] : undefined;
}

export function createScannerRuntime(options: CreateScannerRuntimeOptions): {
  run: (invocation: ScannerWorkerInvocation) => Promise<string>;
  assets: ScannerAssetManager;
  sbomGenerator: 'trivy' | 'syft';
} {
  if (!SUPPORTED_BACKENDS.includes(options.configuration.backend)) {
    throw new Error(
      `Docker scanner runtime does not support backend ${options.configuration.backend}`,
    );
  }
  const assetBackend = options.configuration.backend === 'remote' ? 'remote' : 'docker';
  const sbomGenerator = resolveSbomGenerator(options.configuration);
  const providerIds = selectProviderIds(options.configuration, sbomGenerator);
  providerIds.forEach((provider) => requireBackend(options.backends, provider));

  async function run(invocation: ScannerWorkerInvocation): Promise<string> {
    const backend = requireBackend(options.backends, invocation.provider);
    const result = await backend.run({
      image: getWorkerImage(options.configuration, invocation.provider),
      args: invocation.args,
      env: filterWorkerEnvironment(invocation.provider, invocation.env),
      timeoutMs: invocation.timeoutMs,
      maxOutputBytes: invocation.maxOutputBytes,
      signal: invocation.signal,
    });
    return result.stdout;
  }

  const providers: ScannerAssetProvider[] = providerIds.map((provider) => {
    const backend = requireBackend(options.backends, provider);
    const configuredImage = getWorkerImage(options.configuration, provider);
    let cacheUpdatedAt: string | undefined;
    let databaseUpdatedAt: string | undefined;
    return {
      id: provider,
      backend: assetBackend,
      configuredImage,
      async inspect() {
        try {
          const inspected = await backend.inspectImage(configuredImage);
          return {
            resolvedDigest: inspected.digest,
            version: inspected.version,
            cacheUpdatedAt,
            databaseUpdatedAt,
          };
        } catch (error: unknown) {
          const statusCode = (error as { statusCode?: unknown })?.statusCode;
          if (statusCode === 404) {
            return undefined;
          }
          throw error;
        }
      },
      async pull(auth) {
        await backend.pullImage(
          configuredImage,
          auth,
          getProviderTimeout(options.configuration, provider),
        );
        cacheUpdatedAt = new Date().toISOString();
      },
      async warm() {
        await backend.pullImage(
          configuredImage,
          undefined,
          getProviderTimeout(options.configuration, provider),
        );
        cacheUpdatedAt = new Date().toISOString();
        const args = getWarmupArgs(provider, getProviderTimeout(options.configuration, provider));
        if (!args) {
          return;
        }
        await run({
          provider,
          args,
          timeoutMs: getProviderTimeout(options.configuration, provider),
          maxOutputBytes: 512 * 1024,
        });
        databaseUpdatedAt = new Date().toISOString();
      },
    };
  });

  return {
    run,
    assets: createScannerAssetManager({ providers, audit: options.audit }),
    sbomGenerator,
  };
}

let defaultRuntime: ReturnType<typeof createScannerRuntime> | undefined;
let defaultRuntimeFingerprint = '';

export function getDefaultScannerRuntime(): ReturnType<typeof createScannerRuntime> {
  const configuration = getSecurityConfiguration();
  const fingerprint = JSON.stringify({
    backend: configuration.backend,
    scanner: configuration.scanner,
    sbom: configuration.sbom,
    trivy: configuration.trivy,
    grype: configuration.grype,
    syft: configuration.syft,
    signature: configuration.signature,
    docker: configuration.docker,
  });
  if (defaultRuntime && defaultRuntimeFingerprint === fingerprint) {
    return defaultRuntime;
  }

  const dockerOptions = configuration.docker.host
    ? {
        host: configuration.docker.host,
        port: configuration.docker.port,
        protocol: configuration.docker.protocol,
      }
    : { socketPath: configuration.docker.socket };
  const dockerClient = new Docker(dockerOptions);
  const providerIds = ['trivy', 'grype', 'syft', 'cosign'] as const;
  const backends = Object.fromEntries(
    providerIds.map((provider) => {
      const cacheDir = `volume:${configuration.docker.cacheVolumePrefix}-${provider}`;
      return [
        provider,
        createDockerScannerBackend({
          client: dockerClient,
          cacheDir,
          hardening: {
            networkMode: configuration.docker.network,
            memoryBytes: configuration.docker.workerMemoryBytes,
            ...(provider === 'cosign' ? {} : { scratchTarget: '/scratch' }),
          },
        }),
      ];
    }),
  ) as CreateScannerRuntimeOptions['backends'];

  defaultRuntime = createScannerRuntime({
    configuration,
    backends,
    audit: async (event) => {
      const { recordAuditEvent } = await import('../api/audit-events.js');
      recordAuditEvent({
        action: event.action,
        status: event.action.endsWith('-failed')
          ? 'error'
          : event.action.endsWith('-started')
            ? 'info'
            : 'success',
        containerName: 'system',
        details: `${event.provider} ${event.action}: ${event.diagnostics.error || event.diagnostics.resolvedDigest || event.state}`,
      });
    },
  });
  defaultRuntimeFingerprint = fingerprint;
  return defaultRuntime;
}

/** @internal test helper. */
export function clearDefaultScannerRuntime(): void {
  defaultRuntime = undefined;
  defaultRuntimeFingerprint = '';
}
