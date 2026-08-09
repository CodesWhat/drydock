export const RECENT_DOCKER_EVENT_LIMIT = 1000;
export const RECENT_ALIAS_FILTER_DECISION_LIMIT = 1000;

export function filterAndSliceTimestampedHistory<T extends { timestamp: string }>(
  history: T[],
  sinceMs: number | undefined,
  limit: number,
): T[] {
  const filtered = history.filter((entry) => {
    if (sinceMs === undefined) {
      return true;
    }
    const timestampMs = Date.parse(entry.timestamp);
    return Number.isNaN(timestampMs) ? false : timestampMs >= sinceMs;
  });

  if (!Number.isFinite(limit) || limit <= 0) {
    return filtered;
  }
  return filtered.slice(-Math.trunc(limit));
}

export function appendBoundedHistoryEntry<T>(history: T[], entry: T, maxEntries: number): void {
  history.push(entry);
  if (history.length <= maxEntries * 2) {
    return;
  }
  history.splice(0, history.length - maxEntries);
}
