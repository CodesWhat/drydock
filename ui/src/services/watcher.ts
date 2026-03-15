import { extractCollectionData } from '../utils/api';

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
  const payload = await response.json();
  return extractCollectionData(payload);
}

function buildWatcherDetailPath({ type, name, agent }: WatcherDetailPathOptions) {
  const segments = ['/api/watchers'];
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
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

export { getAllWatchers, getWatcher, getWatcherProviderColor, getWatcherProviderIcon };
