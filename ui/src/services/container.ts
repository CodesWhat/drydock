function getContainerIcon() {
  return 'sh-docker';
}

async function getAllContainers() {
  const response = await fetch('/api/containers', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get containers: ${response.statusText}`);
  }
  return response.json();
}

async function refreshAllContainers() {
  const response = await fetch(`/api/containers/watch`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to refresh all containers: ${response.statusText}`);
  }
  return response.json();
}

async function refreshContainer(containerId) {
  const response = await fetch(`/api/containers/${containerId}/watch`, {
    method: 'POST',
    credentials: 'include',
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`Failed to refresh container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function deleteContainer(containerId) {
  const response = await fetch(`/api/containers/${containerId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete container ${containerId}: ${response.statusText}`);
  }
  return response;
}

async function getContainerTriggers(containerId) {
  const response = await fetch(`/api/containers/${containerId}/triggers`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get triggers for container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function runTrigger({ containerId, triggerType, triggerName, triggerAgent }) {
  const url = triggerAgent
    ? `/api/containers/${containerId}/triggers/${triggerAgent}/${triggerType}/${triggerName}`
    : `/api/containers/${containerId}/triggers/${triggerType}/${triggerName}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to run trigger ${triggerType}/${triggerName}: ${response.statusText}`);
  }
  return response.json();
}

async function getContainerLogs(containerId, tail = 100) {
  const response = await fetch(`/api/containers/${containerId}/logs?tail=${tail}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get logs for container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function updateContainerPolicy(containerId, action, payload = {}) {
  const response = await fetch(`/api/containers/${containerId}/update-policy`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      ...payload,
    }),
  });
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ? ` (${body.error})` : '';
    } catch (e: any) {
      console.debug(`Unable to parse policy update response payload: ${e?.message || e}`);
      // Ignore parsing error and fallback to status text.
    }
    throw new Error(
      `Failed to update container policy ${action}: ${response.statusText}${details}`,
    );
  }
  return response.json();
}

async function scanContainer(containerId) {
  const response = await fetch(`/api/containers/${containerId}/scan`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    let details = '';
    try {
      const body = await response.json();
      details = body?.error ? ` (${body.error})` : '';
    } catch (e: any) {
      console.debug(`Unable to parse scan response payload: ${e?.message || e}`);
    }
    throw new Error(`Failed to scan container: ${response.statusText}${details}`);
  }
  return response.json();
}

export {
  getContainerIcon,
  getAllContainers,
  refreshAllContainers,
  refreshContainer,
  deleteContainer,
  getContainerTriggers,
  getContainerLogs,
  runTrigger,
  scanContainer,
  updateContainerPolicy,
};
