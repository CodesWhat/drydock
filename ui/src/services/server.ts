function getServerIcon() {
  return 'sh-server';
}

async function getServer() {
  const response = await fetch('/api/server', { credentials: 'include' });
  return response.json();
}

export { getServerIcon, getServer };
