function getWatcherIcon() {
  return 'sh-eye';
}

interface WatcherDetailPathOptions {
  type: string;
  name: string;
  agent?: string;
}

function getWatcherProviderIcon(type: string) {
  if (type === 'docker') {
    return 'sh-docker';
  }
  return 'sh-eye';
}

function getWatcherProviderColor(type: string) {
  if (type === 'docker') {
    return '#2496ED';
  }
  return '#6B7280';
}

async function getAllWatchers() {
  const response = await fetch('/api/watchers', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get watchers: ${response.statusText}`);
  }
  return response.json();
}

function buildWatcherDetailPath({ type, name, agent }: WatcherDetailPathOptions) {
  const segments = ['/api/watchers'];
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  return segments.join('/');
}

async function getWatcher({ type, name, agent }: WatcherDetailPathOptions) {
  const response = await fetch(buildWatcherDetailPath({ type, name, agent }), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get watcher: ${response.statusText}`);
  }
  return response.json();
}

export {
  getWatcherIcon,
  getWatcherProviderIcon,
  getWatcherProviderColor,
  getAllWatchers,
  getWatcher,
};
