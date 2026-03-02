import log from '../../../log/index.js';

export function serializeFallbackLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

export function stringifyFallbackLogRecord(record: Record<string, unknown>) {
  const seen = new WeakSet<object>();
  return JSON.stringify(record, (_key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (value instanceof Error) {
      return serializeFallbackLogValue(value);
    }

    if (value && typeof value === 'object') {
      if (seen.has(value as object)) {
        return '[Circular]';
      }
      seen.add(value as object);
    }

    return value;
  });
}

function writeFallbackLogRecord(
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  bindings: Record<string, unknown>,
  args: unknown[],
) {
  const [first, second, ...rest] = args;

  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    logger: 'drydock-watcher-fallback',
    ...bindings,
  };

  if (typeof first === 'string') {
    record.msg = first;
    if (second !== undefined) {
      record.context = serializeFallbackLogValue(second);
    }
  } else if (first !== undefined) {
    if (typeof second === 'string') {
      record.msg = second;
      record.context = serializeFallbackLogValue(first);
    } else {
      record.msg = 'watcher logger fallback event';
      record.context = serializeFallbackLogValue(first);
      if (second !== undefined) {
        rest.unshift(second);
      }
    }
  } else {
    record.msg = 'watcher logger fallback event';
  }

  if (rest.length > 0) {
    record.args = rest.map((arg) => serializeFallbackLogValue(arg));
  }

  try {
    process.stderr.write(`${stringifyFallbackLogRecord(record)}\n`);
  } catch {
    try {
      process.stderr.write(`${record.level}: ${record.msg}\n`);
    } catch {
      // Ignore stderr write failures: fallback logging must never break runtime flow.
    }
  }
}

export function createStderrFallbackLogger(bindings: Record<string, unknown> = {}) {
  const fallbackLogger = {
    trace: (...args: unknown[]) => writeFallbackLogRecord('trace', bindings, args),
    debug: (...args: unknown[]) => writeFallbackLogRecord('debug', bindings, args),
    info: (...args: unknown[]) => writeFallbackLogRecord('info', bindings, args),
    warn: (...args: unknown[]) => writeFallbackLogRecord('warn', bindings, args),
    error: (...args: unknown[]) => writeFallbackLogRecord('error', bindings, args),
    fatal: (...args: unknown[]) => writeFallbackLogRecord('fatal', bindings, args),
    child: (childBindings: Record<string, unknown> = {}) =>
      createStderrFallbackLogger({
        ...bindings,
        ...(childBindings && typeof childBindings === 'object' ? childBindings : {}),
      }),
  };

  return fallbackLogger as unknown as typeof log;
}
