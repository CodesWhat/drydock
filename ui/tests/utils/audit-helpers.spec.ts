import {
  actionIcon,
  actionLabel,
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
});
