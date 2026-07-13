async function getServer() {
  const response = await fetch('/api/v1/server', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get server: ${response.statusText}`);
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
    throw new Error(`Failed to get security runtime status: ${response.statusText}${details}`);
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
    throw new Error(`Scanner asset operation failed: ${response.statusText}${details}`);
  }
  return response.json();
}

export { getSecurityRuntime, getServer, manageSecurityAsset };
