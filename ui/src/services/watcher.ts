function getWatcherIcon() {
  return 'sh-eye';
}

function getWatcherProviderIcon(type) {
  if (type === 'docker') {
    return 'sh-docker';
  }
  return 'sh-eye';
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
