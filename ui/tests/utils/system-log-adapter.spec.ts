import type { SystemLogEntry } from '@/services/system-log-stream';
import { toAppLogEntry } from '@/utils/system-log-adapter';

function makeSystemLogEntry(overrides: Partial<SystemLogEntry> = {}): SystemLogEntry {
  return {
    timestamp: Date.UTC(2026, 2, 15, 0, 0, 0),
    displayTimestamp: '[00:00:00.000]',
    level: 'info',
    component: 'drydock',
    msg: 'hello world',
    ...overrides,
  };
}

describe('toAppLogEntry', () => {
  it('maps plain system log entry fields and parses ANSI segments', () => {
    const entry = makeSystemLogEntry({
      displayTimestamp: '[20:00:00.000]',
      level: 'WARN',
      msg: '\u001b[31mboom\u001b[0m happened',
    });

    const adapted = toAppLogEntry(entry, 42);

    expect(adapted.id).toBe(42);
    expect(adapted.timestamp).toBe('[20:00:00.000]');
    expect(adapted.line).toBe('\u001b[31mboom\u001b[0m happened');
    expect(adapted.plainLine).toBe('boom happened');
    expect(adapted.json).toBeNull();
    expect(adapted.level).toBe('warn');
    expect(adapted.component).toBe('drydock');
    expect(adapted.channel).toBeUndefined();
    expect(adapted.ansiSegments).toEqual([
      { text: 'boom', color: 'red', bold: false, dim: false },
      { text: ' happened', color: null, bold: false, dim: false },
    ]);
  });

  it('extracts log level from JSON payload when present', () => {
    const entry = makeSystemLogEntry({
      level: 'debug',
      msg: '{"level":"ERROR","msg":"db down"}',
    });

    const adapted = toAppLogEntry(entry, 7);

    expect(adapted.level).toBe('error');
    expect(adapted.json?.value).toEqual({ level: 'ERROR', msg: 'db down' });
  });

  it('falls back to entry level when JSON payload has no level key', () => {
    const entry = makeSystemLogEntry({
      level: 'ERROR',
      msg: '{"msg":"db down"}',
    });

    const adapted = toAppLogEntry(entry, 8);

    expect(adapted.json).not.toBeNull();
    expect(adapted.json?.level).toBeNull();
    expect(adapted.level).toBe('error');
  });

  it('uses the server display timestamp when the raw timestamp is invalid', () => {
    const entry = makeSystemLogEntry({
      timestamp: Number.NaN as unknown as number,
      displayTimestamp: '[09:15:00.000]',
      level: '   ',
      msg: 'plain',
    });

    const adapted = toAppLogEntry(entry, 9);

    expect(adapted.timestamp).toBe('[09:15:00.000]');
    expect(adapted.level).toBeNull();
  });

  it('uses the server display timestamp when the raw timestamp is out of range', () => {
    const entry = makeSystemLogEntry({
      timestamp: 8.64e15 + 1,
      displayTimestamp: '[09:16:00.000]',
    });

    const adapted = toAppLogEntry(entry, 10);

    expect(adapted.timestamp).toBe('[09:16:00.000]');
  });
});
