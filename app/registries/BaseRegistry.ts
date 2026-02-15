import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { ContainerImage } from '../model/container.js';
import Registry from './Registry.js';

/**
 * Base Registry with common patterns
 */
class BaseRegistry extends Registry {
  /**
   * Common URL normalization for registries that need https:// prefix and /v2 suffix
   */
  normalizeImageUrl(image: ContainerImage, registryUrl: string | null = null): ContainerImage {
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
  async authenticateBasic(
    requestOptions: AxiosRequestConfig,
    credentials: string | undefined,
  ): Promise<AxiosRequestConfig> {
    const requestOptionsWithAuth: AxiosRequestConfig = {
      ...requestOptions,
      headers: { ...(requestOptions.headers as Record<string, any> | undefined) },
    };
    if (credentials) {
      (requestOptionsWithAuth.headers as Record<string, any>).Authorization = `Basic ${credentials}`;
    }
    return requestOptionsWithAuth;
  }

  /**
   * Common Bearer token authentication
   */
  async authenticateBearer(
    requestOptions: AxiosRequestConfig,
    token: string | undefined,
  ): Promise<AxiosRequestConfig> {
    const requestOptionsWithAuth: AxiosRequestConfig = {
      ...requestOptions,
      headers: { ...(requestOptions.headers as Record<string, any> | undefined) },
    };
    if (token) {
      (requestOptionsWithAuth.headers as Record<string, any>).Authorization = `Bearer ${token}`;
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
    requestOptions: AxiosRequestConfig,
    authUrl: string,
    credentials: string | undefined,
    tokenExtractor: (response: AxiosResponse<any>) => string | undefined = (response) =>
      response.data.token,
  ): Promise<AxiosRequestConfig> {
    const requestOptionsWithAuth: AxiosRequestConfig = {
      ...requestOptions,
      headers: { ...(requestOptions.headers as Record<string, any> | undefined) },
    };
    let token: string | undefined;

    const request: AxiosRequestConfig = {
      method: 'GET',
      url: authUrl,
      headers: {
        Accept: 'application/json',
      },
    };

    if (credentials) {
      (request.headers as Record<string, any>).Authorization = `Basic ${credentials}`;
    }

    try {
      const response = await axios(request);
      token = tokenExtractor(response);
    } catch (e) {
      this.log.warn(`Error when trying to get an access token (${e.message})`);
    }

    if (token) {
      (requestOptionsWithAuth.headers as Record<string, any>).Authorization = `Bearer ${token}`;
    }
    return requestOptionsWithAuth;
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
  matchUrlPattern(image: ContainerImage, pattern: RegExp) {
    return pattern.test(image.registry.url);
  }

  /**
   * Common mask configuration for sensitive fields
   */
  maskSensitiveFields(fields: string[]) {
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
