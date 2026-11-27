import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import tls from 'node:tls';
import type { AxiosRequestConfig } from 'axios';
import { parseProxyConfiguration } from '../triggers/providers/ci-rebuild-shared.js';

const PROXY_ENV_KEYS = [
  'DD_HTTP_PROXY',
  'DD_HTTPS_PROXY',
  'DD_NO_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

function readEnv(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Validate a configured proxy URL. Throws without echoing the value, so a
 * password embedded in a malformed URL never reaches an error message or log.
 */
export function assertValidProxyUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}: proxy must be a non-empty http(s) URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}: proxy is not a valid URL`);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    throw new Error(`${label}: proxy must be an http:// or https:// URL`);
  }
  return value;
}

/**
 * NO_PROXY matching: comma separated hosts. `*` matches everything, `example.com`
 * and `.example.com` match the domain and its subdomains, `host:port` pins a port.
 */
export function shouldBypassProxy(target: URL, noProxy: string | undefined): boolean {
  if (!noProxy) {
    return false;
  }
  const targetHost = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
  for (const rawEntry of noProxy.split(/[,\s]+/)) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) {
      continue;
    }
    if (entry === '*') {
      return true;
    }
    const portMatch = /^(.*):(\d+)$/.exec(entry);
    const hostPattern = (portMatch ? portMatch[1] : entry)
      .replace(/^\*?\./, '')
      .replace(/^\[|\]$/g, '');
    if (portMatch && portMatch[2] !== targetPort) {
      continue;
    }
    if (targetHost === hostPattern || targetHost.endsWith(`.${hostPattern}`)) {
      return true;
    }
  }
  return false;
}

export function hasProxyEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return PROXY_ENV_KEYS.some((key) => Boolean(env[key]?.trim()));
}

/**
 * Pick the proxy for a target URL: the per-registry `proxy` wins, then the
 * DD_* variables, then the standard HTTP(S)_PROXY variables. NO_PROXY is
 * honoured for every source.
 */
export function resolveProxyForUrl(
  targetUrl: string | undefined,
  configuredProxy?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!targetUrl) {
    return undefined;
  }
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return undefined;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return undefined;
  }
  if (shouldBypassProxy(target, readEnv(env, 'DD_NO_PROXY', 'NO_PROXY', 'no_proxy'))) {
    return undefined;
  }
  if (configuredProxy) {
    return configuredProxy;
  }
  return target.protocol === 'https:'
    ? readEnv(env, 'DD_HTTPS_PROXY', 'HTTPS_PROXY', 'https_proxy')
    : readEnv(env, 'DD_HTTP_PROXY', 'HTTP_PROXY', 'http_proxy');
}

function decodeUserinfo(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type CreateConnectionCallback = (error: Error | null, socket?: net.Socket) => void;

/**
 * https.Agent that reaches the origin through an HTTP CONNECT tunnel, then
 * runs TLS (with the registry's CA / mTLS / insecure settings) over it. axios'
 * built-in proxy option sends `GET https://...` to the proxy instead of
 * CONNECT, which authenticating forward proxies reject.
 */
export class ConnectProxyAgent extends https.Agent {
  private readonly proxyUrl: URL;

  constructor(proxyUrl: string, options: https.AgentOptions = {}) {
    super({ keepAlive: true, ...options });
    this.proxyUrl = new URL(proxyUrl);
  }

  // Node calls createConnection(options, callback) on the agent when opening a socket.
  createConnection(options: any, callback: CreateConnectionCallback): any {
    const host = String(options.host ?? 'localhost');
    const port = options.port ?? 443;
    const authority = `${host.includes(':') ? `[${host}]` : host}:${port}`;
    const headers: Record<string, string> = { Host: authority };
    if (this.proxyUrl.username || this.proxyUrl.password) {
      const credentials = `${decodeUserinfo(this.proxyUrl.username)}:${decodeUserinfo(this.proxyUrl.password)}`;
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    const isHttpsProxy = this.proxyUrl.protocol === 'https:';
    // Never include userinfo in anything that can be logged.
    const proxyLabel = `${this.proxyUrl.protocol}//${this.proxyUrl.host}`;
    // Node's agent ignores a second callback, so no extra once-guard is needed.
    const finish = callback;

    const request = (isHttpsProxy ? https : http).request({
      host: this.proxyUrl.hostname.replace(/^\[|\]$/g, ''),
      port: this.proxyUrl.port || (isHttpsProxy ? 443 : 80),
      method: 'CONNECT',
      path: authority,
      headers,
    });
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        finish(
          new Error(
            `Proxy ${proxyLabel} refused CONNECT to ${authority} (status ${response.statusCode})`,
          ),
        );
        return;
      }
      // The agent already sets servername for hostnames, so SNI survives the tunnel.
      finish(null, tls.connect({ ...options, socket }));
    });
    request.once('error', (error) => {
      finish(new Error(`Proxy ${proxyLabel} connection failed: ${error.message}`));
    });
    request.end();
    return undefined;
  }
}

const agentCache = new WeakMap<object, Map<string, ConnectProxyAgent>>();
const NO_BASE_AGENT = {};

function getConnectAgent(proxyUrl: string, baseAgent: unknown): ConnectProxyAgent {
  const cacheKey = baseAgent && typeof baseAgent === 'object' ? baseAgent : NO_BASE_AGENT;
  let byProxy = agentCache.get(cacheKey);
  if (!byProxy) {
    byProxy = new Map();
    agentCache.set(cacheKey, byProxy);
  }
  let agent = byProxy.get(proxyUrl);
  if (!agent) {
    // Carry the registry's TLS settings (CA, client cert, insecure) over the tunnel.
    const baseOptions =
      baseAgent instanceof https.Agent
        ? (baseAgent as unknown as { options?: https.AgentOptions }).options
        : undefined;
    agent = new ConnectProxyAgent(proxyUrl, baseOptions);
    byProxy.set(proxyUrl, agent);
  }
  return agent;
}

/**
 * Route one axios request through the resolved proxy. https targets tunnel via
 * CONNECT; http targets use axios' forward-proxy mode. Axios' own env-proxy
 * handling is switched off whenever any proxy variable is present, so there is
 * a single code path and NO_PROXY decisions made here are not undone.
 */
export function withOutboundProxy(
  requestOptions: AxiosRequestConfig,
  configuredProxy?: string,
  env: NodeJS.ProcessEnv = process.env,
): AxiosRequestConfig {
  const proxyUrl = resolveProxyForUrl(requestOptions.url, configuredProxy, env);
  if (!proxyUrl) {
    return configuredProxy || hasProxyEnvironment(env)
      ? { ...requestOptions, proxy: false }
      : requestOptions;
  }
  if (new URL(requestOptions.url as string).protocol === 'https:') {
    return {
      ...requestOptions,
      proxy: false,
      httpsAgent: getConnectAgent(proxyUrl, requestOptions.httpsAgent),
    };
  }
  return { ...requestOptions, proxy: parseProxyConfiguration(proxyUrl, 'registry') };
}
