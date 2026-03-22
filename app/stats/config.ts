import { toPositiveInteger } from '../util/parse.js';

export const DEFAULT_STATS_INTERVAL_SECONDS = 10;
export const DEFAULT_STATS_HISTORY_SIZE = 60;
export const STATS_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

export function getStatsIntervalSeconds(): number {
  return toPositiveInteger(process.env.DD_STATS_INTERVAL, DEFAULT_STATS_INTERVAL_SECONDS);
}

export function getStatsHistorySize(): number {
  return toPositiveInteger(process.env.DD_STATS_HISTORY_SIZE, DEFAULT_STATS_HISTORY_SIZE);
}
