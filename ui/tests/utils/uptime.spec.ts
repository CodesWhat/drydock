import { i18n } from '@/boot/i18n';
import { formatUptimeFromIso } from '@/utils/uptime';

// Fix "now" at a known reference point: 2024-06-15T12:00:00.000Z
// = 1718445600000 ms since epoch
const NOW_MS = 1718445600000;

describe('formatUptimeFromIso', () => {
  it.each([
    [0, 'Actif depuis 0s'],
    [59, 'Actif depuis 59s'],
    [60, 'Actif depuis 1min'],
    [3599, 'Actif depuis 59min'],
    [3600, 'Actif depuis 1h 0min'],
    [5400, 'Actif depuis 1h 30min'],
    [86399, 'Actif depuis 23h 59min'],
    [86400, 'Actif depuis 1j 0h'],
    [183600, 'Actif depuis 2j 3h'],
  ] as const)('localizes %s seconds of uptime in French', (seconds, expected) => {
    const iso = new Date(NOW_MS - seconds * 1000).toISOString();
    expect(
      formatUptimeFromIso(iso, NOW_MS, 'fr', (key, named) =>
        i18n.global.t(key, named ?? {}, { locale: 'fr' }),
      ),
    ).toBe(expected);
  });

  it.each([
    [30, 'يعمل منذ 30 ث'],
    [120, 'يعمل منذ 2 د'],
    [7200, 'يعمل منذ 2 س 0 د'],
    [172800, 'يعمل منذ 2 ي 0 س'],
  ] as const)('localizes %s seconds of uptime in Arabic', (seconds, expected) => {
    const iso = new Date(NOW_MS - seconds * 1000).toISOString();
    expect(
      formatUptimeFromIso(iso, NOW_MS, 'ar', (key, named) =>
        i18n.global.t(key, named ?? {}, { locale: 'ar' }),
      ),
    ).toBe(expected);
  });

  it('reuses unit formatters across rows and ticks of the same locale', () => {
    const iso = new Date(NOW_MS - 183600_000).toISOString();
    formatUptimeFromIso(iso, NOW_MS, 'ja');
    const NativeNumberFormat = Intl.NumberFormat;
    let constructions = 0;
    Intl.NumberFormat = new Proxy(NativeNumberFormat, {
      construct(target, args) {
        constructions++;
        return Reflect.construct(target, args);
      },
    });
    try {
      for (let tick = 0; tick < 25; tick++) {
        expect(formatUptimeFromIso(iso, NOW_MS + tick * 1000, 'en')).toBe('Up 2d 3h');
      }
      expect(constructions).toBe(4);
    } finally {
      Intl.NumberFormat = NativeNumberFormat;
    }
  });

  describe('undefined / missing input', () => {
    it('returns em-dash for undefined', () => {
      expect(formatUptimeFromIso(undefined, NOW_MS)).toBe('—');
    });

    it('returns em-dash for empty string', () => {
      expect(formatUptimeFromIso('', NOW_MS)).toBe('—');
    });
  });

  describe('Docker zero-time sentinel', () => {
    it('returns em-dash for the canonical Docker zero-time sentinel', () => {
      expect(formatUptimeFromIso('0001-01-01T00:00:00Z', NOW_MS)).toBe('—');
    });

    it('returns em-dash for any string starting with 0001-', () => {
      expect(formatUptimeFromIso('0001-01-01T00:00:00.000Z', NOW_MS)).toBe('—');
    });
  });

  describe('unparseable / future timestamps', () => {
    it('returns em-dash for a non-ISO string', () => {
      expect(formatUptimeFromIso('not-a-date', NOW_MS)).toBe('—');
    });

    it('returns em-dash when startedAt is in the future', () => {
      // startedAt is 1 second after "now"
      const futureMs = NOW_MS + 1000;
      const futureIso = new Date(futureMs).toISOString();
      expect(formatUptimeFromIso(futureIso, NOW_MS)).toBe('—');
    });
  });

  describe('seconds tier (0–59s)', () => {
    it('returns Up 0s for a container just started', () => {
      const iso = new Date(NOW_MS).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 0s');
    });

    it('returns Up 30s for 30 seconds of uptime', () => {
      const iso = new Date(NOW_MS - 30_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 30s');
    });

    it('returns Up 59s for 59 seconds of uptime', () => {
      const iso = new Date(NOW_MS - 59_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 59s');
    });
  });

  describe('minutes tier (1m–59m59s)', () => {
    it('returns Up 1m for exactly 60 seconds', () => {
      const iso = new Date(NOW_MS - 60_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 1m');
    });

    it('returns Up 1m for 90 seconds', () => {
      const iso = new Date(NOW_MS - 90_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 1m');
    });

    it('returns Up 45m for 45 minutes', () => {
      const iso = new Date(NOW_MS - 45 * 60_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 45m');
    });

    it('returns Up 59m for 59 minutes 59 seconds', () => {
      const iso = new Date(NOW_MS - (59 * 60 + 59) * 1000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 59m');
    });
  });

  describe('hours tier (1h–23h59m)', () => {
    it('returns Up 1h 0m for exactly 3600 seconds', () => {
      const iso = new Date(NOW_MS - 3600_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 1h 0m');
    });

    it('returns Up 1h 30m for 1.5 hours', () => {
      const iso = new Date(NOW_MS - 90 * 60_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 1h 30m');
    });

    it('returns Up 23h 59m for 23 hours 59 minutes', () => {
      const iso = new Date(NOW_MS - (23 * 3600 + 59 * 60) * 1000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 23h 59m');
    });
  });

  describe('days tier (1d+)', () => {
    it('returns Up 1d 0h for exactly 86400 seconds', () => {
      const iso = new Date(NOW_MS - 86400_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 1d 0h');
    });

    it('returns Up 2d 3h for 51 hours', () => {
      const iso = new Date(NOW_MS - 51 * 3600_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 2d 3h');
    });

    it('returns Up 7d 0h for exactly 7 days', () => {
      const iso = new Date(NOW_MS - 7 * 86400_000).toISOString();
      expect(formatUptimeFromIso(iso, NOW_MS)).toBe('Up 7d 0h');
    });
  });

  describe('default nowMs parameter', () => {
    it('uses Date.now() when nowMs is omitted', () => {
      // Container started 5 minutes ago
      const iso = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatUptimeFromIso(iso)).toBe('Up 5m');
    });
  });
});
