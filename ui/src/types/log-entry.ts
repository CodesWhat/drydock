import type { AnsiTextSegment, ParsedJsonLogLine } from '../utils/container-logs';

export interface AppLogEntry {
  id: number;
  timestamp: string;
  line: string;
  plainLine: string;
  ansiSegments: AnsiTextSegment[];
  json: ParsedJsonLogLine | null;
  level?: string | null;
  channel?: 'stdout' | 'stderr';
  component?: string;
}
