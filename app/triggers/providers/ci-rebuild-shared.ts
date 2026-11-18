import https from 'node:https';
import axios, { type AxiosRequestConfig } from 'axios';
import { getOutboundHttpTimeoutMs } from '../../configuration/runtime-defaults.js';
import type { Container } from '../../model/container.js';

export const REBUILD_EVENT = 'base-image-update';

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:']);

export interface RebuildContainerContext {
  name: string;
  image: string;
  localTag?: string;
  baseImage: string;
  currentBaseTag?: string;
  newBaseTag?: string;
  currentBaseDigest?: string;
  newBaseDigest?: string;
  updateKind: {
    kind?: string;
    baseImage: boolean;
    semverDiff?: string;
  };
}

export interface RebuildPayload {
  source: 'drydock';
  event: typeof REBUILD_EVENT;
  count: number;
  containers: RebuildContainerContext[];
}

/**
 * Describe one container for a rebuild request. For a locally built image the
 * local tag doubles as the current base version, so `currentBaseTag` comes
 * from the update kind and falls back to the local tag.
 */
export function buildRebuildContainerContext(container: Container): RebuildContainerContext {
  const image = container.image;
  return {
    name: container.name,
    image: image?.name,
    localTag: image?.tag?.value,
    baseImage: image?.registry?.lookupImage ?? image?.name,
    currentBaseTag: container.updateKind?.localValue ?? image?.tag?.value,
    newBaseTag: container.updateKind?.remoteValue ?? container.result?.tag,
    currentBaseDigest: image?.digest?.value,
    newBaseDigest: container.result?.digest,
    updateKind: {
      kind: container.updateKind?.kind,
      baseImage: container.updateKind?.baseImage === true,
      semverDiff: container.updateKind?.semverDiff,
    },
  };
}

/**
 * Keep only the containers a rebuild adapter should act on. Rebuild triggers
 * react to a base image update of a locally built image; `baseimageonly=false`
 * widens them to any update the normal trigger filters let through.
 */
export function selectRebuildContainers(
  containers: Container[],
  baseImageOnly: boolean,
): Container[] {
  if (!baseImageOnly) {
    return containers;
  }
  return containers.filter((container) => container.updateKind?.baseImage === true);
}

export function buildRebuildPayload(containers: Container[]): RebuildPayload {
  return {
    source: 'drydock',
    event: REBUILD_EVENT,
    count: containers.length,
    containers: containers.map((container) => buildRebuildContainerContext(container)),
  };
}

function decodeProxyCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseProxyConfiguration(proxy: string, label: string): AxiosRequestConfig['proxy'] {
  const proxyUrl = new URL(proxy);
  if (!SUPPORTED_PROXY_PROTOCOLS.has(proxyUrl.protocol)) {
    throw new Error(`${label}: proxy URL scheme "${proxyUrl.protocol}" is unsupported`);
  }
  const defaultPort = proxyUrl.protocol === 'https:' ? 443 : 80;
  const proxyConfiguration: NonNullable<AxiosRequestConfig['proxy']> = {
    host: proxyUrl.hostname,
    port: proxyUrl.port ? Number.parseInt(proxyUrl.port, 10) : defaultPort,
    protocol: proxyUrl.protocol.slice(0, -1),
  };
  if (proxyUrl.username || proxyUrl.password) {
    proxyConfiguration.auth = {
      username: decodeProxyCredential(proxyUrl.username),
      password: decodeProxyCredential(proxyUrl.password),
    };
  }
  return proxyConfiguration;
}

/**
 * Replace any userinfo in a proxy URL with a placeholder. An unparseable value
 * is redacted whole so a secret can never ride through untouched.
 */
export function maskProxyUrl(proxy: string): string {
  let parsed: URL;
  try {
    parsed = new URL(proxy);
  } catch {
    return '[REDACTED]';
  }
  if (!parsed.host) {
    return '[REDACTED]';
  }
  if (!parsed.username && !parsed.password) {
    return proxy;
  }
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.protocol}//[REDACTED]@${parsed.host}${path}${parsed.search}${parsed.hash}`;
}

export interface RebuildTransportConfiguration {
  proxy?: string;
  insecure?: boolean;
}

export function buildRebuildRequestOptions(
  configuration: RebuildTransportConfiguration,
  label: string,
): AxiosRequestConfig {
  const options: AxiosRequestConfig = {
    method: 'POST',
    timeout: getOutboundHttpTimeoutMs(),
    // Redirects must never forward the credential to another host.
    maxRedirects: 0,
  };
  if (configuration.proxy) {
    options.proxy = parseProxyConfiguration(configuration.proxy, label);
  }
  if (configuration.insecure) {
    // Intentional opt-in for self-hosted GitHub Enterprise / GitLab with private CAs.
    // lgtm[js/disabling-certificate-validation]
    options.httpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return options;
}

/**
 * Send the request and report a failure without the axios error object, whose
 * config carries the credential and the request body.
 */
export async function sendRebuildRequest(
  options: AxiosRequestConfig,
  label: string,
): Promise<unknown> {
  try {
    const response = await axios(options);
    return response.data;
  } catch (error: unknown) {
    const failure = error as {
      message?: string;
      code?: string;
      response?: { status?: number; data?: { message?: unknown } };
    };
    const status = failure.response?.status;
    const detail = failure.response?.data?.message;
    const parts = [
      status === undefined ? (failure.code ?? undefined) : `HTTP ${status}`,
      typeof detail === 'string' ? detail : undefined,
      status === undefined ? failure.message : undefined,
    ].filter((part): part is string => Boolean(part));
    throw new Error(`${label} rebuild request failed: ${parts.join(' - ') || 'unknown error'}`);
  }
}
