import { EventEmitter } from 'node:events';

export interface LogEntry {
  timestamp: number;
  level: string;
  component: string;
  msg: string;
}

const entryEmitter = new EventEmitter();
entryEmitter.setMaxListeners(0);

const LEVEL_ORDER: Record<string, number> = {
  debug: 10,
  trace: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const MAX_SIZE = 1000;
const buffer: LogEntry[] = new Array(MAX_SIZE);
let head = 0;
let count = 0;

export function addEntry(entry: LogEntry): void {
  buffer[head] = entry;
  head = (head + 1) % MAX_SIZE;
  if (count < MAX_SIZE) {
    count++;
  }
  entryEmitter.emit('entry', entry);
}

export function onEntry(listener: (entry: LogEntry) => void): () => void {
  entryEmitter.on('entry', listener);
  return () => {
    entryEmitter.off('entry', listener);
  };
}

interface GetEntriesOptions {
  level?: string;
  component?: string;
  tail?: number;
  since?: number;
}

function getStartIndex(currentHead: number, currentCount: number, maxSize: number): number {
  return (currentHead - currentCount + maxSize) % maxSize;
}

function readRingBuffer(
  entriesBuffer: LogEntry[],
  start: number,
  currentCount: number,
  maxSize: number,
): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let i = 0; i < currentCount; i++) {
    entries.push(entriesBuffer[(start + i) % maxSize]);
  }
  return entries;
}

function drainBuffer(): LogEntry[] {
  const start = getStartIndex(head, count, MAX_SIZE);
  return readRingBuffer(buffer, start, count, MAX_SIZE);
}

export function getMinLevel(level?: string): number {
  if (!level) {
    return 0;
  }
  return LEVEL_ORDER[level] ?? 0;
}

export function meetsMinLevel(entry: LogEntry, minLevel: number): boolean {
  if (minLevel <= 0) {
    return true;
  }
  return (LEVEL_ORDER[entry.level] ?? 0) >= minLevel;
}

export function matchesComponent(entry: LogEntry, component?: string): boolean {
  if (!component) {
    return true;
  }
  return entry.component.includes(component);
}

function isSince(entry: LogEntry, since?: number): boolean {
  if (since === undefined) {
    return true;
  }
  return entry.timestamp >= since;
}

function applyTail(entries: LogEntry[], tail: number): LogEntry[] {
  if (entries.length > tail) {
    return entries.slice(entries.length - tail);
  }
  return entries;
}

function applyFilters(entries: LogEntry[], options?: GetEntriesOptions): LogEntry[] {
  const minLevel = getMinLevel(options?.level);
  const component = options?.component;
  const since = options?.since;
  const filtered = entries.filter(
    (entry) =>
      meetsMinLevel(entry, minLevel) && matchesComponent(entry, component) && isSince(entry, since),
  );
  return applyTail(filtered, options?.tail ?? 100);
}

export function getEntries(options?: GetEntriesOptions): LogEntry[] {
  if (count === 0) {
    return [];
  }
  return applyFilters(drainBuffer(), options);
}

export function getComponents(): string[] {
  if (count === 0) {
    return [];
  }
  const components = new Set<string>();
  const start = getStartIndex(head, count, MAX_SIZE);
  for (let i = 0; i < count; i++) {
    const entry = buffer[(start + i) % MAX_SIZE];
    if (entry?.component) {
      components.add(entry.component);
    }
  }
  return Array.from(components).sort();
}
