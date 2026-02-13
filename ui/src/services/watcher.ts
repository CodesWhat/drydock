function getWatcherIcon() {
  return 'fas fa-eye';
}

function getWatcherProviderIcon(type) {
  if (type === 'docker') {
    return 'fab fa-docker';
  }
  return 'fas fa-eye';
}

function getWatcherProviderColor(type) {
  if (type === 'docker') {
    return '#2496ED';
  }
  return '#6B7280';
}

async function getAllWatchers() {
  const response = await fetch('/api/watchers', { credentials: 'include' });
  return response.json();
}

export { getWatcherIcon, getWatcherProviderIcon, getWatcherProviderColor, getAllWatchers };
