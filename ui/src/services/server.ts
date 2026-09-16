import { i18n } from '../boot/i18n';

async function getServer() {
  const response = await fetch('/api/v1/server', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(
      `${i18n.global.t('serversView.loadError')} (HTTP ${response.status})${response.statusText ? `: ${response.statusText}` : ''}`,
    );
  }
  return response.json();
}

async function apiErrorDetails(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body?.error === 'string' && body.error ? ` (${body.error})` : '';
  } catch {
    return '';
  }
}

async function getSecurityRuntime() {
  const response = await fetch('/api/v1/server/security/runtime', { credentials: 'include' });
  if (!response.ok) {
    const details = await apiErrorDetails(response);
    throw new Error(
      `${i18n.global.t('securityView.runtimeLoadError')} (HTTP ${response.status})${response.statusText ? `: ${response.statusText}` : ''}${details}`,
    );
  }
  return response.json();
}

async function manageSecurityAsset(
  provider: 'trivy' | 'grype' | 'syft',
  operation: 'pull' | 'warm',
) {
  const response = await fetch(`/api/v1/server/security/assets/${provider}/${operation}`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const details = await apiErrorDetails(response);
    throw new Error(
      `${i18n.global.t('securityView.runtimeTools.assetOperationFailed')} (HTTP ${response.status})${response.statusText ? `: ${response.statusText}` : ''}${details}`,
    );
  }
  return response.json();
}

export { getSecurityRuntime, getServer, manageSecurityAsset };
