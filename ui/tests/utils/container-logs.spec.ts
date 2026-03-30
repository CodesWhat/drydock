import {
  extractJsonLogLevel,
  parseAnsiSegments,
  parseJsonLogLine,
  parseLogTimestampToUnixSeconds,
  stripAnsiCodes,
} from '@/utils/container-logs';

describe('container log utils', () => {
  describe('parseAnsiSegments', () => {
    it('returns plain text segment when no ANSI sequence exists', () => {
      expect(parseAnsiSegments('plain text')).toEqual([
        {
          text: 'plain text',
          color: null,
          bold: false,
          dim: false,
        },
      ]);
    });

    it('splits and annotates ANSI colored segments', () => {
      const input = 'start \u001b[31mred\u001b[0m end';
      expect(parseAnsiSegments(input)).toEqual([
        {
          text: 'start ',
          color: null,
          bold: false,
          dim: false,
        },
        {
          text: 'red',
          color: 'red',
          bold: false,
          dim: false,
        },
        {
          text: ' end',
          color: null,
          bold: false,
          dim: false,
        },
      ]);
    });

    it('tracks bold/dim codes and resets state', () => {
      const input = '\u001b[1;32mgreen\u001b[22m plain \u001b[2mghost\u001b[0m';
      expect(parseAnsiSegments(input)).toEqual([
        {
          text: 'green',
          color: 'green',
          bold: true,
          dim: false,
        },
        {
          text: ' plain ',
          color: 'green',
          bold: false,
          dim: false,
        },
        {
          text: 'ghost',
          color: 'green',
          bold: false,
          dim: true,
        },
      ]);
    });

    it('drops empty segments created by consecutive ANSI sequences', () => {
      const input = '\u001b[31m\u001b[0m';
      expect(parseAnsiSegments(input)).toEqual([]);
    });

    it('resets only color when ANSI 39 is present', () => {
      const input = '\u001b[31mred\u001b[39m plain';
      expect(parseAnsiSegments(input)).toEqual([
        {
          text: 'red',
          color: 'red',
          bold: false,
          dim: false,
        },
        {
          text: ' plain',
          color: null,
          bold: false,
          dim: false,
        },
      ]);
    });

    it('handles empty and unsupported ANSI codes without mutating style state', () => {
      const input = 'x\u001b[m y\u001b[;m z\u001b[90m end';
      expect(parseAnsiSegments(input)).toEqual([
        {
          text: 'x',
          color: null,
          bold: false,
          dim: false,
        },
        {
          text: ' y',
          color: null,
          bold: false,
          dim: false,
        },
        {
          text: ' z',
          color: null,
          bold: false,
          dim: false,
        },
        {
          text: ' end',
          color: null,
          bold: false,
          dim: false,
        },
      ]);
    });
  });

  describe('stripAnsiCodes', () => {
    it('removes ANSI escape sequences from text', () => {
      const input = 'foo \u001b[31mbar\u001b[0m baz';
      expect(stripAnsiCodes(input)).toBe('foo bar baz');
    });
  });

  describe('parseJsonLogLine', () => {
    it('returns null for non-JSON text', () => {
      expect(parseJsonLogLine('not json')).toBeNull();
    });

    it('returns null when ANSI-only payload strips to empty text', () => {
      expect(parseJsonLogLine('\u001b[31m\u001b[0m')).toBeNull();
    });

    it('parses JSON object line and extracts normalized level', () => {
      const parsed = parseJsonLogLine('{"level":"WARN","msg":"boom"}');
      expect(parsed).toEqual({
        level: 'warn',
        pretty: '{\n  "level": "WARN",\n  "msg": "boom"\n}',
        value: {
          level: 'WARN',
          msg: 'boom',
        },
      });
    });

    it('ignores JSON primitives as structured logs', () => {
      expect(parseJsonLogLine('"hello"')).toBeNull();
      expect(parseJsonLogLine('123')).toBeNull();
      expect(parseJsonLogLine('true')).toBeNull();
    });

    it('supports ANSI wrapped JSON payloads', () => {
      const parsed = parseJsonLogLine('\u001b[32m{"severity":"ERROR"}\u001b[0m');
      expect(parsed?.level).toBe('error');
      expect(parsed?.value).toEqual({ severity: 'ERROR' });
    });
  });

  describe('extractJsonLogLevel', () => {
    it('returns null when no known level key exists', () => {
      expect(extractJsonLogLevel({ message: 'hello' })).toBeNull();
      expect(extractJsonLogLevel(null)).toBeNull();
      expect(extractJsonLogLevel({ level: {} })).toBeNull();
    });

    it('normalizes numeric log levels from pino style values', () => {
      expect(extractJsonLogLevel({ level: 10 })).toBe('trace');
      expect(extractJsonLogLevel({ level: 20 })).toBe('debug');
      expect(extractJsonLogLevel({ level: 30 })).toBe('info');
      expect(extractJsonLogLevel({ level: 40 })).toBe('warn');
      expect(extractJsonLogLevel({ level: 50 })).toBe('error');
      expect(extractJsonLogLevel({ level: 60 })).toBe('fatal');
      expect(extractJsonLogLevel({ level: 70 })).toBe('70');
    });

    it('checks fallback key aliases for level', () => {
      expect(extractJsonLogLevel({ severity: 'ERROR' })).toBe('error');
      expect(extractJsonLogLevel({ logLevel: 'INFO' })).toBe('info');
      expect(extractJsonLogLevel({ log_level: 'debug' })).toBe('debug');
      expect(extractJsonLogLevel({ lvl: 'warn' })).toBe('warn');
    });

    it('returns null for whitespace-only string levels', () => {
      expect(extractJsonLogLevel({ level: '   ' })).toBeNull();
    });
  });

  describe('parseLogTimestampToUnixSeconds', () => {
    it('returns floored unix seconds for finite numbers', () => {
      expect(parseLogTimestampToUnixSeconds(42.9)).toBe(42);
    });

    it('returns undefined for empty string and non-string values', () => {
      expect(parseLogTimestampToUnixSeconds('   ')).toBeUndefined();
      expect(parseLogTimestampToUnixSeconds({})).toBeUndefined();
    });

    it('returns undefined for invalid date strings', () => {
      expect(parseLogTimestampToUnixSeconds('not-a-date')).toBeUndefined();
    });

    it('parses valid date strings to unix seconds', () => {
      expect(parseLogTimestampToUnixSeconds('2026-03-15T00:00:00.999Z')).toBe(1773532800);
    });
  });
});
