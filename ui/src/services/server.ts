function getServerIcon() {
  return 'sh-server';
}

async function getServer() {
  const response = await fetch('/api/server', { credentials: 'include' });
  return response.json();
}

async function getSecurityRuntime() {
  const response = await fetch('/api/server/security/runtime', { credentials: 'include' });
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ? ` (${body.error})` : '';
    } catch {
      // ignore non-JSON errors and fallback to status text.
    }
    throw new Error(`Failed to get security runtime status: ${response.statusText}${details}`);
  }
  return response.json();
}

export { getServerIcon, getServer, getSecurityRuntime };
