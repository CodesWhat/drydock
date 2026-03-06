async function getAppInfos() {
  const response = await fetch('/api/app', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get app infos: ${response.statusText}`);
  }
  return response.json();
}

export { getAppInfos };
