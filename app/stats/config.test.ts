import {
  DEFAULT_STATS_HISTORY_SIZE,
  DEFAULT_STATS_INTERVAL_SECONDS,
  getStatsHistorySize,
  getStatsIntervalSeconds,
} from './config.js';

describe('stats/config', () => {
  test('uses defaults when env vars are not set', () => {
    const previousInterval = process.env.DD_STATS_INTERVAL;
    const previousHistory = process.env.DD_STATS_HISTORY_SIZE;

    try {
      delete process.env.DD_STATS_INTERVAL;
      delete process.env.DD_STATS_HISTORY_SIZE;

      expect(getStatsIntervalSeconds()).toBe(DEFAULT_STATS_INTERVAL_SECONDS);
      expect(getStatsHistorySize()).toBe(DEFAULT_STATS_HISTORY_SIZE);
    } finally {
      if (previousInterval === undefined) {
        delete process.env.DD_STATS_INTERVAL;
      } else {
        process.env.DD_STATS_INTERVAL = previousInterval;
      }
      if (previousHistory === undefined) {
        delete process.env.DD_STATS_HISTORY_SIZE;
      } else {
        process.env.DD_STATS_HISTORY_SIZE = previousHistory;
      }
    }
  });

  test('uses valid positive integer overrides', () => {
    const previousInterval = process.env.DD_STATS_INTERVAL;
    const previousHistory = process.env.DD_STATS_HISTORY_SIZE;

    try {
      process.env.DD_STATS_INTERVAL = '5';
      process.env.DD_STATS_HISTORY_SIZE = '120';

      expect(getStatsIntervalSeconds()).toBe(5);
      expect(getStatsHistorySize()).toBe(120);
    } finally {
      if (previousInterval === undefined) {
        delete process.env.DD_STATS_INTERVAL;
      } else {
        process.env.DD_STATS_INTERVAL = previousInterval;
      }
      if (previousHistory === undefined) {
        delete process.env.DD_STATS_HISTORY_SIZE;
      } else {
        process.env.DD_STATS_HISTORY_SIZE = previousHistory;
      }
    }
  });

  test('falls back to defaults for invalid values', () => {
    const previousInterval = process.env.DD_STATS_INTERVAL;
    const previousHistory = process.env.DD_STATS_HISTORY_SIZE;

    try {
      process.env.DD_STATS_INTERVAL = '0';
      process.env.DD_STATS_HISTORY_SIZE = '-2';

      expect(getStatsIntervalSeconds()).toBe(DEFAULT_STATS_INTERVAL_SECONDS);
      expect(getStatsHistorySize()).toBe(DEFAULT_STATS_HISTORY_SIZE);
    } finally {
      if (previousInterval === undefined) {
        delete process.env.DD_STATS_INTERVAL;
      } else {
        process.env.DD_STATS_INTERVAL = previousInterval;
      }
      if (previousHistory === undefined) {
        delete process.env.DD_STATS_HISTORY_SIZE;
      } else {
        process.env.DD_STATS_HISTORY_SIZE = previousHistory;
      }
    }
  });
});
