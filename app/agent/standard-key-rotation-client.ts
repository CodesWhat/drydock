import axios, { type AxiosRequestConfig } from 'axios';
import { signRequest } from './ed25519-signer.js';
import type { KeyRotationStatus, RotationRequest } from './standard-key-rotation.js';

export function createRotationRequest(
  baseUrl: string,
  options: AxiosRequestConfig,
): RotationRequest {
  return async (identity, action, payload) => {
    const target = '/_portwing/auth/rotation' + (action === 'status' ? '' : `/${action}`);
    const method = action === 'status' ? 'GET' : 'POST';
    const data = action === 'status' ? undefined : (payload ?? {});
    const headers = signRequest({
      method,
      path: target,
      keyId: identity.keyId,
      privateKey: identity.privateKey,
      body: data === undefined ? undefined : Buffer.from(JSON.stringify(data)),
    });
    const response = await axios.request<KeyRotationStatus>({
      ...options,
      method,
      url: baseUrl + target,
      data,
      headers: { ...options.headers, ...headers },
      timeout: 30_000,
      maxContentLength: 4096,
      maxBodyLength: 4096,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error('Agent key rotation request failed'), {
        status: response.status,
      });
    }
    return response.data;
  };
}
