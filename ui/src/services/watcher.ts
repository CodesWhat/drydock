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

function buildWatcherDetailPath({ type, name, agent }) {
  const segments = ['/api/watchers'];
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  return segments.join('/');
}

async function getWatcher({ type, name, agent }) {
  const response = await fetch(buildWatcherDetailPath({ type, name, agent }), {
    credentials: 'include',
  });
  return response.json();
}

export {
  getWatcherIcon,
  getWatcherProviderIcon,
  getWatcherProviderColor,
  getAllWatchers,
  getWatcher,
};
