import {
  actionIcon,
  actionLabel,
  formatAbsoluteTime,
  imageAge,
  statusBg,
  statusColor,
  targetLabel,
  timeAgo,
} from '@/utils/audit-helpers';

describe('audit-helpers', () => {
  describe('statusColor', () => {
    it('returns success color', () => {
      expect(statusColor('success')).toBe('var(--dd-success)');
    });
    it('returns error/danger color', () => {
      expect(statusColor('error')).toBe('var(--dd-danger)');
    });
    it('returns info color for info', () => {
      expect(statusColor('info')).toBe('var(--dd-info)');
    });
    it('returns info color for unknown status', () => {
      expect(statusColor('unknown')).toBe('var(--dd-info)');
    });
  });

  describe('statusBg', () => {
    it('returns success-muted bg', () => {
      expect(statusBg('success')).toBe('var(--dd-success-muted)');
    });
    it('returns danger-muted bg', () => {
      expect(statusBg('error')).toBe('var(--dd-danger-muted)');
    });
    it('returns info-muted bg for info', () => {
      expect(statusBg('info')).toBe('var(--dd-info-muted)');
    });
    it('returns info-muted bg for unknown status', () => {
      expect(statusBg('other')).toBe('var(--dd-info-muted)');
    });
  });

  describe('actionLabel', () => {
    it('title-cases hyphenated actions', () => {
      expect(actionLabel('update-available')).toBe('Update Available');
    });
    it('handles single-word actions', () => {
      expect(actionLabel('preview')).toBe('Preview');
    });
    it('handles multi-segment actions', () => {
      expect(actionLabel('hook-pre-success')).toBe('Hook Pre Success');
    });
  });

  describe('actionIcon', () => {
    it.each([
      ['update-available', 'updates'],
      ['update-applied', 'check'],
      ['update-failed', 'xmark'],
      ['notification-delivery-failed', 'xmark'],
      ['security-alert', 'security'],
      ['agent-disconnect', 'network'],
      ['rollback', 'restart'],
      ['auto-rollback', 'restart'],
      ['container-start', 'play'],
      ['container-stop', 'stop'],
      ['container-restart', 'restart'],
      ['container-added', 'containers'],
      ['container-removed', 'trash'],
      ['webhook-watch', 'bolt'],
      ['webhook-update', 'bolt'],
      ['hook-pre-success', 'triggers'],
      ['hook-post-failed', 'triggers'],
      ['preview', 'search'],
      ['unknown-action', 'info'],
    ] as const)('returns %s icon for "%s"', (action, expected) => {
      expect(actionIcon(action)).toBe(expected);
    });
  });

  describe('targetLabel', () => {
    it('returns Agent for agent-disconnect', () => {
      expect(targetLabel('agent-disconnect')).toBe('Agent');
    });
    it('returns Container for other actions', () => {
      expect(targetLabel('update-available')).toBe('Container');
    });
    it('returns Container for unknown actions', () => {
      expect(targetLabel('something')).toBe('Container');
    });
  });

  describe('timeAgo', () => {
    it('returns "just now" for timestamps less than 60 seconds ago', () => {
      const now = new Date().toISOString();
      expect(timeAgo(now)).toBe('just now');
    });

    it('returns "just now" for future timestamps', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(timeAgo(future)).toBe('just now');
    });

    it('returns minutes ago', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(timeAgo(fiveMinAgo)).toBe('5m ago');
    });

    it('returns 1m ago at exactly 60 seconds', () => {
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
      expect(timeAgo(oneMinAgo)).toBe('1m ago');
    });

    it('returns hours ago', () => {
      const threeHrsAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(timeAgo(threeHrsAgo)).toBe('3h ago');
    });

    it('returns days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
      expect(timeAgo(twoDaysAgo)).toBe('2d ago');
    });

    it('returns "Mon D" format for 7+ days ago', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const expected = `${months[tenDaysAgo.getMonth()]} ${tenDaysAgo.getDate()}`;
      expect(timeAgo(tenDaysAgo.toISOString())).toBe(expected);
    });

    it('returns the raw string for invalid dates', () => {
      expect(timeAgo('not-a-date')).toBe('not-a-date');
    });

    it('returns 59m ago at boundary', () => {
      const fiftyNineMin = new Date(Date.now() - 59 * 60_000).toISOString();
      expect(timeAgo(fiftyNineMin)).toBe('59m ago');
    });

    it('returns 1h ago at 60 minutes', () => {
      const sixtyMin = new Date(Date.now() - 60 * 60_000).toISOString();
      expect(timeAgo(sixtyMin)).toBe('1h ago');
    });

    it('returns 23h ago at boundary', () => {
      const twentyThreeHrs = new Date(Date.now() - 23 * 3_600_000).toISOString();
      expect(timeAgo(twentyThreeHrs)).toBe('23h ago');
    });

    it('returns 1d ago at 24 hours', () => {
      const twentyFourHrs = new Date(Date.now() - 24 * 3_600_000).toISOString();
      expect(timeAgo(twentyFourHrs)).toBe('1d ago');
    });

    it('returns 6d ago at boundary', () => {
      const sixDays = new Date(Date.now() - 6 * 86_400_000).toISOString();
      expect(timeAgo(sixDays)).toBe('6d ago');
    });
  });

  describe('formatAbsoluteTime', () => {
    it('returns empty string for undefined', () => {
      expect(formatAbsoluteTime(undefined)).toBe('');
    });

    it('returns empty string for null', () => {
      expect(formatAbsoluteTime(null)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(formatAbsoluteTime('')).toBe('');
    });

    it('returns empty string for an invalid date string', () => {
      expect(formatAbsoluteTime('not-a-date')).toBe('');
    });

    it('returns a formatted string for a valid ISO timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'));
      const result = formatAbsoluteTime('2026-04-09T13:30:00.000Z');
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(result).toMatch(/[A-Z][a-z]{2}/);
      vi.useRealTimers();
    });
  });

  describe('imageAge', () => {
    it('returns em dash for undefined', () => {
      expect(imageAge(undefined)).toBe('\u2014');
    });

    it('returns em dash for invalid date', () => {
      expect(imageAge('not-a-date')).toBe('\u2014');
    });

    it('returns "now" for future timestamps', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(imageAge(future)).toBe('now');
    });

    it('returns minutes for recent images', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(imageAge(fiveMinAgo)).toBe('5m');
    });

    it('returns hours', () => {
      const threeHrsAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(imageAge(threeHrsAgo)).toBe('3h');
    });

    it('returns days for under 2 weeks', () => {
      const tenDays = new Date(Date.now() - 10 * 86_400_000).toISOString();
      expect(imageAge(tenDays)).toBe('10d');
    });

    it('returns weeks for 14-59 days', () => {
      const thirtyDays = new Date(Date.now() - 30 * 86_400_000).toISOString();
      expect(imageAge(thirtyDays)).toBe('4w');
    });

    it('returns months for 60-364 days', () => {
      const ninetyDays = new Date(Date.now() - 90 * 86_400_000).toISOString();
      expect(imageAge(ninetyDays)).toBe('2mo');
    });

    it('returns years for 365+ days', () => {
      const twoYears = new Date(Date.now() - 730 * 86_400_000).toISOString();
      expect(imageAge(twoYears)).toBe('1y');
    });

    it('returns em dash for empty string', () => {
      expect(imageAge('')).toBe('\u2014');
    });
  });
});
