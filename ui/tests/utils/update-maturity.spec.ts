import { formatUpdateAge } from '@/utils/update-maturity';

const ONE_DAY = 86_400_000;
const ONE_HOUR = 3_600_000;
const ONE_MINUTE = 60_000;

describe('update-maturity', () => {
  describe('formatUpdateAge', () => {
    it('returns undefined when no update available', () => {
      expect(formatUpdateAge(3 * ONE_DAY, false)).toBeUndefined();
    });

    it('returns undefined when ageMs is undefined', () => {
      expect(formatUpdateAge(undefined, true)).toBeUndefined();
    });

    it('formats days plural', () => {
      expect(formatUpdateAge(3 * ONE_DAY, true)).toBe('Detected 3 days ago');
    });

    it('formats day singular', () => {
      expect(formatUpdateAge(ONE_DAY, true)).toBe('Detected 1 day ago');
    });

    it('formats hours plural', () => {
      expect(formatUpdateAge(5 * ONE_HOUR, true)).toBe('Detected 5 hours ago');
    });

    it('formats hour singular', () => {
      expect(formatUpdateAge(ONE_HOUR, true)).toBe('Detected 1 hour ago');
    });

    it('formats minutes plural', () => {
      expect(formatUpdateAge(10 * ONE_MINUTE, true)).toBe('Detected 10 minutes ago');
    });

    it('formats minute singular', () => {
      expect(formatUpdateAge(ONE_MINUTE, true)).toBe('Detected 1 minute ago');
    });

    it('formats just now', () => {
      expect(formatUpdateAge(30_000, true)).toBe('Detected just now');
    });

    it('formats zero age as just now', () => {
      expect(formatUpdateAge(0, true)).toBe('Detected just now');
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
        const result = formatUpdateAge(ONE_DAY, true, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableDaysSingular"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableDaysSingular');
      });

      it('calls plural days key for 2+ days', () => {
        const result = formatUpdateAge(2 * ONE_DAY, true, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableDaysPlural:{\\"count\\":2}"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableDaysPlural', {
          count: 2,
        });
      });

      it('calls singular hours key for 1 hour', () => {
        const result = formatUpdateAge(ONE_HOUR, true, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableHoursSingular"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableHoursSingular');
      });

      it('calls plural hours key for 2+ hours', () => {
        const result = formatUpdateAge(2 * ONE_HOUR, true, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableHoursPlural:{\\"count\\":2}"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableHoursPlural', {
          count: 2,
        });
      });

      it('calls singular minutes key for 1 minute', () => {
        const result = formatUpdateAge(ONE_MINUTE, true, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableMinutesSingular"}',
        );
        expect(mockT).toHaveBeenCalledWith(
          'containerComponents.updateAge.availableMinutesSingular',
        );
      });

      it('calls plural minutes key for 2+ minutes', () => {
        const result = formatUpdateAge(2 * ONE_MINUTE, true, mockT);
        expect(result).toBe(
          'containerComponents.maturityBadge.new:{"duration":"containerComponents.updateAge.availableMinutesPlural:{\\"count\\":2}"}',
        );
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.availableMinutesPlural', {
          count: 2,
        });
      });

      it('calls justNow key for zero age', () => {
        const result = formatUpdateAge(30_000, true, mockT);
        // justNow bypasses the duration/wrapping template entirely.
        expect(result).toBe('containerComponents.updateAge.justNow');
        expect(mockT).toHaveBeenCalledWith('containerComponents.updateAge.justNow');
      });
    });
  });
});
