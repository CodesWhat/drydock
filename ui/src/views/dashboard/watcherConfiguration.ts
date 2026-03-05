import type { ApiWatcherConfiguration } from '../../types/api';

export function getWatcherConfiguration(watcher: unknown): ApiWatcherConfiguration {
  if (!watcher || typeof watcher !== 'object') {
    return {};
  }

  const watcherRecord = watcher as Record<string, unknown>;
  if (watcherRecord.configuration && typeof watcherRecord.configuration === 'object') {
    return watcherRecord.configuration as ApiWatcherConfiguration;
  }
  if (watcherRecord.config && typeof watcherRecord.config === 'object') {
    return watcherRecord.config as ApiWatcherConfiguration;
  }
  return {};
}
