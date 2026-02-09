function getContainerIcon() {
  return "mdi-docker";
}

async function getAllContainers() {
  const response = await fetch("/api/containers", { credentials: "include" });
  return response.json();
}

async function refreshAllContainers() {
  const response = await fetch(`/api/containers/watch`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to refresh all containers: ${response.statusText}`);
  }
  return response.json();
}

async function refreshContainer(containerId) {
  const response = await fetch(`/api/containers/${containerId}/watch`, {
    method: "POST",
    credentials: "include",
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
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to delete container ${containerId}: ${response.statusText}`);
  }
  return response;
}

async function getContainerTriggers(containerId) {
  const response = await fetch(`/api/containers/${containerId}/triggers`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to get triggers for container ${containerId}: ${response.statusText}`);
  }
  return response.json();
}

async function runTrigger({
  containerId,
  triggerType,
  triggerName,
  triggerAgent,
}) {
  const url = triggerAgent
    ? `/api/containers/${containerId}/triggers/${triggerAgent}/${triggerType}/${triggerName}`
    : `/api/containers/${containerId}/triggers/${triggerType}/${triggerName}`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to run trigger ${triggerType}/${triggerName}: ${response.statusText}`);
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
  runTrigger,
};
