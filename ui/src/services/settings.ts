export interface Settings {
  internetlessMode: boolean;
}

async function getSettings(): Promise<Settings> {
  const response = await fetch('/api/settings', { credentials: 'include' });
  return response.json();
}

async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const response = await fetch('/api/settings', {
    method: 'PUT',
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

export { getSettings, updateSettings };
