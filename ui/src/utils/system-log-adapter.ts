import type { SystemLogEntry } from '../services/system-log-stream';
import type { AppLogEntry } from '../types/log-entry';
import { parseAnsiSegments, parseJsonLogLine, stripAnsiCodes } from './container-logs';

function normalizeLevel(level: string): string | null {
  const trimmed = level.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function toAppLogEntry(entry: SystemLogEntry, id: number): AppLogEntry {
  const line = entry.msg;
  const json = parseJsonLogLine(line);
  const fallbackLevel = normalizeLevel(entry.level);

  return {
    id,
    timestamp: entry.displayTimestamp,
    line,
    plainLine: stripAnsiCodes(line),
    ansiSegments: parseAnsiSegments(line),
    json,
    level: json?.level ?? fallbackLevel,
    component: entry.component,
  };
}
