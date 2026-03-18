interface Settings {
  internetlessMode: boolean;
}

async function getSettings(): Promise<Settings> {
  const response = await fetch('/api/v1/settings', { credentials: 'include' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const response = await fetch('/api/v1/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

async function clearIconCache(): Promise<{ cleared: number }> {
  const response = await fetch('/api/v1/icons/cache', {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export { clearIconCache, getSettings, updateSettings };
