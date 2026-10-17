import { i18n } from '../boot/i18n';

export async function readHttpError(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return `${i18n.global.t('common.apiResponse.invalidJson', { context: 'API' })} (HTTP ${response.status})`;
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string' &&
    body.error.trim()
  ) {
    return body.error;
  }
  return `HTTP ${response.status}`;
}
