import { formatUptimeFromIso } from '@/utils/uptime';

// Fix "now" at a known reference point: 2024-06-15T12:00:00.000Z
// = 1718445600000 ms since epoch
const NOW_MS = 1718445600000;

describe('formatUptimeFromIso', () => {
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
