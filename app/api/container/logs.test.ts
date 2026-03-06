import { describe, expect, test } from 'vitest';
import { isLocalDockerWatcherApi } from './logs.js';

describe('api/container/logs', () => {
  describe('isLocalDockerWatcherApi', () => {
    test('returns false for non-object values', () => {
      expect(isLocalDockerWatcherApi(undefined)).toBe(false);
      expect(isLocalDockerWatcherApi(null)).toBe(false);
      expect(isLocalDockerWatcherApi('docker.local')).toBe(false);
      expect(isLocalDockerWatcherApi(42)).toBe(false);
    });

    test('returns false when dockerApi is missing', () => {
      expect(isLocalDockerWatcherApi({})).toBe(false);
      expect(isLocalDockerWatcherApi({ dockerApi: undefined })).toBe(false);
    });

    test('returns false when dockerApi.getContainer is not a function', () => {
      expect(isLocalDockerWatcherApi({ dockerApi: {} })).toBe(false);
      expect(isLocalDockerWatcherApi({ dockerApi: { getContainer: 'nope' } })).toBe(false);
    });

    test('returns true when dockerApi.getContainer is a function', () => {
      const watcher = {
        dockerApi: {
          getContainer: () => ({ logs: async () => '' }),
        },
      };

      expect(isLocalDockerWatcherApi(watcher)).toBe(true);
    });
  });
});
