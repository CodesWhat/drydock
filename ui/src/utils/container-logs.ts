export type AnsiColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | null;

export interface AnsiTextSegment {
  text: string;
  color: AnsiColor;
  bold: boolean;
  dim: boolean;
}

export interface ParsedJsonLogLine {
  level: string | null;
  pretty: string;
  value: Record<string, unknown>;
}

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[([0-9;]*)m`, 'g');
const ANSI_STRIP_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, 'g');

const COLOR_BY_CODE: Record<number, Exclude<AnsiColor, null>> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
};

function applyAnsiCode(
  code: number,
  state: {
    color: AnsiColor;
    bold: boolean;
    dim: boolean;
  },
): void {
  if (code === 0) {
    state.color = null;
    state.bold = false;
    state.dim = false;
    return;
  }
  if (code === 1) {
    state.bold = true;
    return;
  }
  if (code === 2) {
    state.dim = true;
    return;
  }
  if (code === 22) {
    state.bold = false;
    state.dim = false;
    return;
  }
  if (code === 39) {
    state.color = null;
    return;
  }
  const color = COLOR_BY_CODE[code];
  if (color) {
    state.color = color;
  }
}

export function parseAnsiSegments(input: string): AnsiTextSegment[] {
  const segments: AnsiTextSegment[] = [];
  const state = {
    color: null as AnsiColor,
    bold: false,
    dim: false,
  };

  let lastIndex = 0;
  for (const match of input.matchAll(ANSI_PATTERN)) {
    const matchIndex = match.index as number;
    const text = input.slice(lastIndex, matchIndex);
    if (text.length > 0) {
      segments.push({
        text,
        color: state.color,
        bold: state.bold,
        dim: state.dim,
      });
    }

    const rawCodes = match[1]?.length ? match[1].split(';') : ['0'];
    for (const rawCode of rawCodes) {
      const code = Number.parseInt(rawCode, 10);
      if (Number.isFinite(code)) {
        applyAnsiCode(code, state);
      }
    }

    lastIndex = matchIndex + match[0].length;
  }

  const tail = input.slice(lastIndex);
  if (tail.length > 0) {
    segments.push({
      text: tail,
      color: state.color,
      bold: state.bold,
      dim: state.dim,
    });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

export function stripAnsiCodes(input: string): string {
  return input.replace(ANSI_STRIP_PATTERN, '');
}

function normalizeLevel(rawLevel: unknown): string | null {
  if (typeof rawLevel === 'number' && Number.isFinite(rawLevel)) {
    if (rawLevel === 10) return 'trace';
    if (rawLevel === 20) return 'debug';
    if (rawLevel === 30) return 'info';
    if (rawLevel === 40) return 'warn';
    if (rawLevel === 50) return 'error';
    if (rawLevel === 60) return 'fatal';
    return `${rawLevel}`;
  }

  if (typeof rawLevel === 'string') {
    const trimmed = rawLevel.trim();
    return trimmed.length > 0 ? trimmed.toLowerCase() : null;
  }

  return null;
}

export function extractJsonLogLevel(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const logObject = value as Record<string, unknown>;
  const levelKeys = ['level', 'severity', 'logLevel', 'log_level', 'lvl'] as const;

  for (const key of levelKeys) {
    if (key in logObject) {
      const normalized = normalizeLevel(logObject[key]);
      if (normalized !== null) {
        return normalized;
      }
    }
  }

  return null;
}

export function parseJsonLogLine(input: string): ParsedJsonLogLine | null {
  const stripped = stripAnsiCodes(input).trim();
  if (stripped.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    return {
      level: extractJsonLogLevel(value),
      pretty: JSON.stringify(value, null, 2),
      value,
    };
  } catch {
    return null;
  }
}

export function parseLogTimestampToUnixSeconds(timestamp: unknown): number | undefined {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return Math.floor(timestamp);
  }
  if (typeof timestamp !== 'string' || timestamp.trim().length === 0) {
    return undefined;
  }

  const parsedMs = Date.parse(timestamp);
  if (Number.isNaN(parsedMs)) {
    return undefined;
  }
  return Math.floor(parsedMs / 1000);
}
