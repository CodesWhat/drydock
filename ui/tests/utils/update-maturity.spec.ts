import { formatUpdateAge } from '@/utils/update-maturity';

const NOW = new Date('2026-03-13T12:00:00Z').getTime();
const ONE_DAY = 86_400_000;
const ONE_HOUR = 3_600_000;
const ONE_MINUTE = 60_000;

describe('update-maturity', () => {
  describe('formatUpdateAge', () => {
    it('uses Date.now when nowMs is omitted', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW));
      try {
        const twoHoursAgo = new Date(NOW - 2 * ONE_HOUR).toISOString();
        expect(formatUpdateAge(twoHoursAgo, true)).toBe('Detected 2 hours ago');
      } finally {
        vi.useRealTimers();
      }
    });

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
      expect(formatUpdateAge(threeDaysAgo, true, NOW)).toBe('Detected 3 days ago');
    });

    it('formats day singular', () => {
      const oneDayAgo = new Date(NOW - ONE_DAY).toISOString();
      expect(formatUpdateAge(oneDayAgo, true, NOW)).toBe('Detected 1 day ago');
    });

    it('formats hours plural', () => {
      const fiveHoursAgo = new Date(NOW - 5 * ONE_HOUR).toISOString();
      expect(formatUpdateAge(fiveHoursAgo, true, NOW)).toBe('Detected 5 hours ago');
    });

    it('formats hour singular', () => {
      const oneHourAgo = new Date(NOW - ONE_HOUR).toISOString();
      expect(formatUpdateAge(oneHourAgo, true, NOW)).toBe('Detected 1 hour ago');
    });

    it('formats minutes plural', () => {
      const tenMinutesAgo = new Date(NOW - 10 * ONE_MINUTE).toISOString();
      expect(formatUpdateAge(tenMinutesAgo, true, NOW)).toBe('Detected 10 minutes ago');
    });

    it('formats minute singular', () => {
      const oneMinuteAgo = new Date(NOW - ONE_MINUTE).toISOString();
      expect(formatUpdateAge(oneMinuteAgo, true, NOW)).toBe('Detected 1 minute ago');
    });

    it('formats just now', () => {
      const justNow = new Date(NOW - 30_000).toISOString();
      expect(formatUpdateAge(justNow, true, NOW)).toBe('Detected just now');
    });

    it('clamps negative age to zero', () => {
      const futureDate = new Date(NOW + ONE_HOUR).toISOString();
      expect(formatUpdateAge(futureDate, true, NOW)).toBe('Detected just now');
    });

    describe('with t param', () => {
      const mockT = vi.fn((key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
      );

      beforeEach(() => {
        mockT.mockClear();
      });

      // With a t() provided, the duration sub-key is resolved first and then threaded
      // into the "Detected {duration} ago" template (containerComponents.maturityBadge.new)
      // — formatUpdateAge no longer returns the raw duration translation directly.
      it('calls singular days key for 1 day', () => {
        const oneDayAgo = new Date(NOW - ONE_DAY).toISOString();
        const result = formatUpdateAge(oneDayAgo, true, NOW, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableDaysSingular"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableDaysSingular');
      });

      it('calls plural days key for 2+ days', () => {
        const twoDaysAgo = new Date(NOW - 2 * ONE_DAY).toISOString();
        const result = formatUpdateAge(twoDaysAgo, true, NOW, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableDaysPlural:{\\"count\\":2}"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableDaysPlural', {
          count: 2,
        });
      });

      it('calls singular hours key for 1 hour', () => {
        const oneHourAgo = new Date(NOW - ONE_HOUR).toISOString();
        const result = formatUpdateAge(oneHourAgo, true, NOW, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableHoursSingular"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableHoursSingular');
      });

      it('calls plural hours key for 2+ hours', () => {
        const twoHoursAgo = new Date(NOW - 2 * ONE_HOUR).toISOString();
        const result = formatUpdateAge(twoHoursAgo, true, NOW, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableHoursPlural:{\\"count\\":2}"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableHoursPlural', {
          count: 2,
        });
      });

      it('calls singular minutes key for 1 minute', () => {
        const oneMinuteAgo = new Date(NOW - ONE_MINUTE).toISOString();
        const result = formatUpdateAge(oneMinuteAgo, true, NOW, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableMinutesSingular"}',
        );
        expect(mockT).toHaveBeenCalledWith(
          'containerComponents.updateAge.availableMinutesSingular',
        );
      });

      it('calls plural minutes key for 2+ minutes', () => {
        const twoMinutesAgo = new Date(NOW - 2 * ONE_MINUTE).toISOString();
        const result = formatUpdateAge(twoMinutesAgo, true, NOW, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableMinutesPlural:{\\"count\\":2}"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableMinutesPlural', {
          count: 2,
        });
      });

      it('calls justNow key for zero age', () => {
        const justNow = new Date(NOW - 30_000).toISOString();
        const result = formatUpdateAge(justNow, true, NOW, mockT);
        // justNow bypasses the duration/wrapping template entirely.
        expect(result).toBe('containerComponents.updateAge.justNow');
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.justNow');
      });
    });
  });
});
