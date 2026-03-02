import { describe, expect, test, vi } from 'vitest';

import {
  createStderrFallbackLogger,
  serializeFallbackLogValue,
  stringifyFallbackLogRecord,
} from './fallback-logger.js';

describe('docker fallback logger module', () => {
  test('serializes error and bigint values safely', () => {
    const error = new Error('boom');
    const serializedError = serializeFallbackLogValue(error) as any;
    expect(serializedError.message).toBe('boom');
    expect(serializeFallbackLogValue(12n)).toBe('12');
  });

  test('stringifies circular objects without throwing', () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    const stringified = stringifyFallbackLogRecord({
      value: circular,
      count: 7n,
    });
    expect(stringified).toContain('"[Circular]"');
    expect(stringified).toContain('"7"');
  });

  test('writes structured log lines to stderr for info events', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = createStderrFallbackLogger({ component: 'watcher.docker.test' });
      logger.info('hello world', { tag: 'v1.2.3' });

      expect(stderrSpy).toHaveBeenCalled();
      const firstCallArg = `${stderrSpy.mock.calls[0][0]}`;
      expect(firstCallArg).toContain('"logger":"drydock-watcher-fallback"');
      expect(firstCallArg).toContain('"msg":"hello world"');
      expect(firstCallArg).toContain('"component":"watcher.docker.test"');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('supports object-first and empty-args log invocations across levels', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = createStderrFallbackLogger({ watcher: 'docker' });
      logger.trace({ kind: 'trace' }, 'trace-msg', 1n, new Error('trace-err'));
      logger.debug({ context: 'debug' }, { extra: true }, 'tail');
      logger.fatal();

      const traceRecord = JSON.parse(`${stderrSpy.mock.calls[0][0]}`);
      expect(traceRecord.level).toBe('trace');
      expect(traceRecord.msg).toBe('trace-msg');
      expect(traceRecord.context).toEqual({ kind: 'trace' });
      expect(traceRecord.args).toEqual(['1', expect.objectContaining({ message: 'trace-err' })]);

      const debugRecord = JSON.parse(`${stderrSpy.mock.calls[1][0]}`);
      expect(debugRecord.level).toBe('debug');
      expect(debugRecord.msg).toBe('watcher logger fallback event');
      expect(debugRecord.context).toEqual({ context: 'debug' });
      expect(debugRecord.args).toEqual([{ extra: true }, 'tail']);

      const fatalRecord = JSON.parse(`${stderrSpy.mock.calls[2][0]}`);
      expect(fatalRecord.level).toBe('fatal');
      expect(fatalRecord.msg).toBe('watcher logger fallback event');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('falls back to plain stderr output when structured write throws', () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementationOnce(() => {
        throw new Error('structured write failed');
      })
      .mockImplementationOnce(() => true);
    try {
      const logger = createStderrFallbackLogger();
      logger.error('fallback-msg');

      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(`${stderrSpy.mock.calls[1][0]}`).toContain('error: fallback-msg');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test('stringifies Error values in records and ignores non-object child bindings', () => {
    const stringified = stringifyFallbackLogRecord({ err: new Error('record-boom') });
    expect(stringified).toContain('"message":"record-boom"');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = createStderrFallbackLogger({ component: 'root' });
      const childLogger = logger.child('invalid-child-bindings' as any);
      childLogger.info({ scope: 'context-only' });

      const record = JSON.parse(`${stderrSpy.mock.calls[0][0]}`);
      expect(record.component).toBe('root');
      expect(record.msg).toBe('watcher logger fallback event');
      expect(record.context).toEqual({ scope: 'context-only' });
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
