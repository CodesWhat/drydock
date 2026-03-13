import { formatUpdateAge, getUpdateMaturity } from '@/utils/update-maturity';

const NOW = new Date('2026-03-13T12:00:00Z').getTime();
const ONE_DAY = 86_400_000;
const ONE_HOUR = 3_600_000;
const ONE_MINUTE = 60_000;
const SEVEN_DAYS = 7 * ONE_DAY;

describe('update-maturity', () => {
  describe('getUpdateMaturity', () => {
    it('returns null when no update is available', () => {
      expect(getUpdateMaturity('2026-03-10T00:00:00Z', false, NOW)).toBeNull();
    });

    it('returns null when updateDetectedAt is undefined', () => {
      expect(getUpdateMaturity(undefined, true, NOW)).toBeNull();
    });

    it('returns null when updateDetectedAt is an invalid date', () => {
      expect(getUpdateMaturity('not-a-date', true, NOW)).toBeNull();
    });

    it('returns fresh when update is less than 7 days old', () => {
      const sixDaysAgo = new Date(NOW - 6 * ONE_DAY).toISOString();
      expect(getUpdateMaturity(sixDaysAgo, true, NOW)).toBe('fresh');
    });

    it('returns fresh when update was just detected', () => {
      const justNow = new Date(NOW - 1000).toISOString();
      expect(getUpdateMaturity(justNow, true, NOW)).toBe('fresh');
    });

    it('returns settled when update is exactly 7 days old', () => {
      const sevenDaysAgo = new Date(NOW - SEVEN_DAYS).toISOString();
      expect(getUpdateMaturity(sevenDaysAgo, true, NOW)).toBe('settled');
    });

    it('returns settled when update is older than 7 days', () => {
      const tenDaysAgo = new Date(NOW - 10 * ONE_DAY).toISOString();
      expect(getUpdateMaturity(tenDaysAgo, true, NOW)).toBe('settled');
    });

    it('respects custom threshold', () => {
      const twoDaysAgo = new Date(NOW - 2 * ONE_DAY).toISOString();
      expect(getUpdateMaturity(twoDaysAgo, true, NOW, ONE_DAY)).toBe('settled');
      expect(getUpdateMaturity(twoDaysAgo, true, NOW, 3 * ONE_DAY)).toBe('fresh');
    });
  });

  describe('formatUpdateAge', () => {
    it('returns undefined when no update available', () => {
      expect(formatUpdateAge('2026-03-10T00:00:00Z', false, NOW)).toBeUndefined();
    });

    it('returns undefined when updateDetectedAt is undefined', () => {
      expect(formatUpdateAge(undefined, true, NOW)).toBeUndefined();
    });

    it('returns undefined for invalid date', () => {
      expect(formatUpdateAge('invalid', true, NOW)).toBeUndefined();
    });

    it('formats days plural', () => {
      const threeDaysAgo = new Date(NOW - 3 * ONE_DAY).toISOString();
      expect(formatUpdateAge(threeDaysAgo, true, NOW)).toBe('Available for 3 days');
    });

    it('formats day singular', () => {
      const oneDayAgo = new Date(NOW - ONE_DAY).toISOString();
      expect(formatUpdateAge(oneDayAgo, true, NOW)).toBe('Available for 1 day');
    });

    it('formats hours plural', () => {
      const fiveHoursAgo = new Date(NOW - 5 * ONE_HOUR).toISOString();
      expect(formatUpdateAge(fiveHoursAgo, true, NOW)).toBe('Available for 5 hours');
    });

    it('formats hour singular', () => {
      const oneHourAgo = new Date(NOW - ONE_HOUR).toISOString();
      expect(formatUpdateAge(oneHourAgo, true, NOW)).toBe('Available for 1 hour');
    });

    it('formats minutes plural', () => {
      const tenMinutesAgo = new Date(NOW - 10 * ONE_MINUTE).toISOString();
      expect(formatUpdateAge(tenMinutesAgo, true, NOW)).toBe('Available for 10 minutes');
    });

    it('formats minute singular', () => {
      const oneMinuteAgo = new Date(NOW - ONE_MINUTE).toISOString();
      expect(formatUpdateAge(oneMinuteAgo, true, NOW)).toBe('Available for 1 minute');
    });

    it('formats just now', () => {
      const justNow = new Date(NOW - 30_000).toISOString();
      expect(formatUpdateAge(justNow, true, NOW)).toBe('Available just now');
    });

    it('clamps negative age to zero', () => {
      const futureDate = new Date(NOW + ONE_HOUR).toISOString();
      expect(formatUpdateAge(futureDate, true, NOW)).toBe('Available just now');
    });
  });
});
