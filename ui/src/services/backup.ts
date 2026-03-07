async function getBackups(containerId: string) {
  const response = await fetch(`/api/containers/${containerId}/backups`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get backups for container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function rollback(containerId: string, backupId?: string) {
  const options: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-DD-Confirm-Action': 'container-rollback',
    },
  };
  if (backupId) {
    options.body = JSON.stringify({ backupId });
  }
  const response = await fetch(`/api/containers/${containerId}/rollback`, options);
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ? ` (${body.error})` : '';
    } catch (e: unknown) {
      const parseErrorMessage = e instanceof Error ? e.message : 'Unknown parsing error';
      details = ` (unable to parse error response: ${parseErrorMessage})`;
    }
    throw new Error(`Rollback failed: ${response.statusText}${details}`);
  }
  return response.json();
}

export { getBackups, rollback };
