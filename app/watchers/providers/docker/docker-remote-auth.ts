import fs from 'node:fs';
import Dockerode from 'dockerode';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import { getErrorMessage } from './docker-helpers.js';
import type { MutableOidcState, OidcContext, OidcRemoteAuthConfiguration } from './oidc.js';
import {
  initializeRemoteOidcStateFromConfiguration,
  isRemoteOidcTokenRefreshRequired,
  refreshRemoteOidcAccessToken,
} from './oidc.js';

type DockerRemoteAuthConfiguration = OidcRemoteAuthConfiguration & {
  insecure?: boolean;
};

interface DockerRemoteAuthWatcher {
  name: string;
  dockerApi: Dockerode;
  remoteAuthBlockedReason?: string;
  remoteOidcAccessToken?: string;
  configuration: {
    host?: string;
    socket: string;
    port: number;
    protocol?: 'http' | 'https';
    cafile?: string;
    certfile?: string;
    keyfile?: string;
    auth?: DockerRemoteAuthConfiguration;
  };
  log: {
    warn: (message: string) => void;
  };
  applyRemoteAuthHeaders: (options: Dockerode.DockerOptions) => void;
  getRemoteAuthResolution: (auth: OidcRemoteAuthConfiguration | undefined) => {
    authType: string;
    hasBearer: boolean;
    hasBasic: boolean;
    hasOidcConfig: boolean;
  };
  isHttpsRemoteWatcher: (options: Dockerode.DockerOptions) => boolean;
  handleRemoteAuthFailure: (message: string) => void;
  getOidcContext: () => OidcContext;
  getOidcStateAdapter: () => MutableOidcState;
  setRemoteAuthorizationHeader: (authorizationValue: string) => void;
}

export function initWatcherWithRemoteAuth(watcher: DockerRemoteAuthWatcher): void {
  const options: Dockerode.DockerOptions = {};
  watcher.remoteAuthBlockedReason = undefined;
  if (watcher.configuration.host) {
    options.host = watcher.configuration.host;
    options.port = watcher.configuration.port;
    if (watcher.configuration.protocol) {
      options.protocol = watcher.configuration.protocol;
    }
    if (watcher.configuration.cafile) {
      options.ca = fs.readFileSync(
        resolveConfiguredPath(watcher.configuration.cafile, {
          label: `watcher ${watcher.name} CA file path`,
        }),
      );
    }
    if (watcher.configuration.certfile) {
      options.cert = fs.readFileSync(
        resolveConfiguredPath(watcher.configuration.certfile, {
          label: `watcher ${watcher.name} certificate file path`,
        }),
      );
    }
    if (watcher.configuration.keyfile) {
      options.key = fs.readFileSync(
        resolveConfiguredPath(watcher.configuration.keyfile, {
          label: `watcher ${watcher.name} key file path`,
        }),
      );
    }
    try {
      watcher.applyRemoteAuthHeaders(options);
    } catch (e: unknown) {
      const authFailureMessage = getErrorMessage(
        e,
        `Unable to authenticate remote watcher ${watcher.name}`,
      );
      watcher.remoteAuthBlockedReason = authFailureMessage;
      watcher.log.warn(
        `Remote watcher ${watcher.name} auth is blocked (${authFailureMessage}); watcher remains registered but remote sync is disabled until auth is fixed or auth.insecure=true is set`,
      );
    }
  } else {
    options.socketPath = watcher.configuration.socket;
  }
  watcher.dockerApi = new Dockerode(options);
}

export async function ensureRemoteAuthHeadersForWatcher(
  watcher: DockerRemoteAuthWatcher,
): Promise<void> {
  if (watcher.remoteAuthBlockedReason) {
    throw new Error(watcher.remoteAuthBlockedReason);
  }

  if (!watcher.configuration.host || !watcher.configuration.auth) {
    return;
  }

  const auth = watcher.configuration.auth;
  const { authType } = watcher.getRemoteAuthResolution(auth);
  if (authType !== 'oidc') {
    return;
  }
  if (
    !watcher.isHttpsRemoteWatcher({
      protocol: watcher.configuration.protocol,
      ca: watcher.configuration.cafile,
      cert: watcher.configuration.certfile,
      key: watcher.configuration.keyfile,
    } as Dockerode.DockerOptions)
  ) {
    watcher.handleRemoteAuthFailure(
      `Unable to authenticate remote watcher ${watcher.name}: HTTPS is required for OIDC auth (set protocol=https or TLS certificates)`,
    );
    return;
  }

  initializeRemoteOidcStateFromConfiguration(watcher.getOidcContext());

  if (isRemoteOidcTokenRefreshRequired(watcher.getOidcStateAdapter())) {
    await refreshRemoteOidcAccessToken(watcher.getOidcContext());
  }
  if (!watcher.remoteOidcAccessToken) {
    throw new Error(
      `Unable to authenticate remote watcher ${watcher.name}: no OIDC access token available`,
    );
  }
  watcher.setRemoteAuthorizationHeader(`Bearer ${watcher.remoteOidcAccessToken}`);
}

export function applyRemoteAuthHeadersForWatcher(
  watcher: DockerRemoteAuthWatcher,
  options: Dockerode.DockerOptions,
): void {
  const auth = watcher.configuration.auth;
  if (!auth) {
    return;
  }

  const { authType, hasBearer, hasBasic, hasOidcConfig } = watcher.getRemoteAuthResolution(auth);
  if (!hasBearer && !hasBasic && !hasOidcConfig && authType !== 'oidc') {
    watcher.handleRemoteAuthFailure(
      `Unable to authenticate remote watcher ${watcher.name}: credentials are incomplete`,
    );
    return;
  }

  if (!watcher.isHttpsRemoteWatcher(options)) {
    watcher.handleRemoteAuthFailure(
      `Unable to authenticate remote watcher ${watcher.name}: HTTPS is required for remote auth (set protocol=https or TLS certificates)`,
    );
    return;
  }

  if (authType === 'basic') {
    if (!hasBasic) {
      watcher.handleRemoteAuthFailure(
        `Unable to authenticate remote watcher ${watcher.name}: basic credentials are incomplete`,
      );
      return;
    }
    const token = Buffer.from(`${auth.user}:${auth.password}`).toString('base64');
    options.headers = {
      ...options.headers,
      Authorization: `Basic ${token}`,
    };
    return;
  }

  if (authType === 'bearer') {
    if (!hasBearer) {
      watcher.handleRemoteAuthFailure(
        `Unable to authenticate remote watcher ${watcher.name}: bearer token is missing`,
      );
      return;
    }
    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${auth.bearer}`,
    };
    return;
  }

  if (authType === 'oidc') {
    initializeRemoteOidcStateFromConfiguration(watcher.getOidcContext());
    if (watcher.remoteOidcAccessToken) {
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${watcher.remoteOidcAccessToken}`,
      };
    }
    return;
  }

  watcher.handleRemoteAuthFailure(
    `Unable to authenticate remote watcher ${watcher.name}: auth type "${authType}" is unsupported`,
  );
}
