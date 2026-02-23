// @ts-nocheck
import fs from 'node:fs';
import https from 'node:https';
import axios from 'axios';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { failClosedAuth, withAuthorizationHeader } from '../security/auth.js';
import Registry from './Registry.js';

/**
 * Base Registry with common patterns
 */
class BaseRegistry extends Registry {
  private httpsAgent;

  private getHttpsAgent() {
    const shouldDisableTlsVerification = this.configuration?.insecure === true;
    const hasCaFile = Boolean(this.configuration?.cafile);
    if (!shouldDisableTlsVerification && !hasCaFile) {
      return undefined;
    }

    if (this.httpsAgent) {
      return this.httpsAgent;
    }

    let ca;
    if (hasCaFile) {
      const caPath = resolveConfiguredPath(this.configuration.cafile, {
        label: `registry ${this.getId()} CA file path`,
      });
      ca = fs.readFileSync(caPath);
    }

    // Intentional opt-in for self-hosted registries with private/self-signed cert chains.
    // lgtm[js/disabling-certificate-validation]
    this.httpsAgent = new https.Agent({
      ca,
      rejectUnauthorized: !shouldDisableTlsVerification,
    });
    return this.httpsAgent;
  }

  private withTlsRequestOptions(requestOptions) {
    const httpsAgent = requestOptions?.httpsAgent || this.getHttpsAgent();
    if (!httpsAgent) {
      return requestOptions;
    }
    return {
      ...requestOptions,
      httpsAgent,
    };
  }

  /**
   * Common URL normalization for registries that need https:// prefix and /v2 suffix
   */
  normalizeImageUrl(image, registryUrl = null) {
    const imageNormalized = { ...image };
    const url = registryUrl || image.registry.url;

    if (!url.startsWith('https://')) {
      imageNormalized.registry.url = `https://${url}/v2`;
    }
    return imageNormalized;
  }

  /**
   * Common Basic Auth implementation
   */
  async authenticateBasic(requestOptions, credentials) {
    const requestOptionsWithAuth = this.withTlsRequestOptions({ ...requestOptions });
    if (credentials) {
      requestOptionsWithAuth.headers = requestOptionsWithAuth.headers || {};
      requestOptionsWithAuth.headers.Authorization = `Basic ${credentials}`;
    }
    return requestOptionsWithAuth;
  }

  /**
   * Common Bearer token authentication
   */
  async authenticateBearer(requestOptions, token) {
    const requestOptionsWithAuth = this.withTlsRequestOptions({ ...requestOptions });
    if (token) {
      requestOptionsWithAuth.headers = requestOptionsWithAuth.headers || {};
      requestOptionsWithAuth.headers.Authorization = `Bearer ${token}`;
    }
    return requestOptionsWithAuth;
  }

  /**
   * Common Bearer token authentication via auth URL.
   * Fetches a token from an auth endpoint using optional Basic credentials,
   * then sets the Bearer token on the request options.
   * @param requestOptions - the request options to augment with auth
   * @param authUrl - the URL to fetch the bearer token from
   * @param credentials - optional Base64 credentials for Basic auth on the token request
   * @param tokenExtractor - function to extract the token from the axios response (default: response.data.token)
   * @returns the request options with Authorization header set
   */
  async authenticateBearerFromAuthUrl(
    requestOptions,
    authUrl,
    credentials,
    tokenExtractor = (response) => response.data.token,
  ) {
    const requestOptionsWithAuth = this.withTlsRequestOptions({
      ...requestOptions,
    });

    const request = this.withTlsRequestOptions({
      method: 'GET',
      url: authUrl,
      headers: {
        Accept: 'application/json',
      },
    });

    if (credentials) {
      request.headers.Authorization = `Basic ${credentials}`;
    }

    let response;
    try {
      response = await axios(request);
    } catch (e) {
      failClosedAuth(
        `Unable to authenticate registry ${this.getId()}: token request failed (${e.message})`,
      );
    }

    return withAuthorizationHeader(
      requestOptionsWithAuth,
      'Bearer',
      tokenExtractor(response),
      `Unable to authenticate registry ${this.getId()}: token endpoint response does not contain token`,
    );
  }

  /**
   * Common credentials helper for login/password or auth field
   */
  getAuthCredentials() {
    if (this.configuration.auth) {
      return this.configuration.auth;
    }
    if (this.configuration.login && this.configuration.password) {
      return BaseRegistry.base64Encode(this.configuration.login, this.configuration.password);
    }
    return undefined;
  }

  /**
   * Common auth pull credentials
   */
  async getAuthPull() {
    if (this.configuration.login && this.configuration.password) {
      return {
        username: this.configuration.login,
        password: this.configuration.password,
      };
    }
    if (this.configuration.username && this.configuration.token) {
      return {
        username: this.configuration.username,
        password: this.configuration.token,
      };
    }
    return undefined;
  }

  /**
   * Common URL pattern matching
   */
  matchUrlPattern(image, pattern) {
    return pattern.test(image.registry.url);
  }

  /**
   * Common mask configuration for sensitive fields
   */
  maskSensitiveFields(fields) {
    const masked = { ...this.configuration };
    fields.forEach((field) => {
      if (masked[field]) {
        masked[field] = BaseRegistry.mask(masked[field]);
      }
    });
    return masked;
  }
}

export default BaseRegistry;
