async function startContainer(containerId: string) {
  const response = await fetch(`/api/containers/${containerId}/start`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to start container: ${response.statusText}`);
  }
  return response.json();
}

async function stopContainer(containerId: string) {
  const response = await fetch(`/api/containers/${containerId}/stop`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to stop container: ${response.statusText}`);
  }
  return response.json();
}

async function restartContainer(containerId: string) {
  const response = await fetch(`/api/containers/${containerId}/restart`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to restart container: ${response.statusText}`);
  }
  return response.json();
}

async function updateContainer(containerId: string) {
  const response = await fetch(`/api/containers/${containerId}/update`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to update container: ${response.statusText}`);
  }
  return response.json();
}

export { restartContainer, startContainer, stopContainer, updateContainer };
