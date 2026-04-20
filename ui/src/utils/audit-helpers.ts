export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  containerName: string;
  containerImage?: string;
  fromVersion?: string;
  toVersion?: string;
  triggerName?: string;
  status: 'success' | 'error' | 'info';
  details?: string;
}

export function statusColor(status: string): string {
  if (status === 'success') return 'var(--dd-success)';
  if (status === 'error') return 'var(--dd-danger)';
  return 'var(--dd-info)';
}

export function statusBg(status: string): string {
  if (status === 'success') return 'var(--dd-success-muted)';
  if (status === 'error') return 'var(--dd-danger-muted)';
  return 'var(--dd-info-muted)';
}

export function actionLabel(action: string): string {
  return action
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function actionIcon(action: string): string {
  if (action.includes('update-available')) return 'updates';
  if (action.includes('update-applied')) return 'check';
  if (action.includes('update-failed')) return 'xmark';
  if (action.includes('notification-delivery-failed')) return 'xmark';
  if (action.includes('security-alert')) return 'security';
  if (action.includes('agent-disconnect')) return 'network';
  if (action.includes('rollback') || action === 'auto-rollback') return 'restart';
  if (action.includes('restart')) return 'restart';
  if (action.includes('start')) return 'play';
  if (action.includes('stop')) return 'stop';
  if (action.includes('added')) return 'containers';
  if (action.includes('removed')) return 'trash';
  if (action.includes('webhook')) return 'bolt';
  if (action.includes('hook')) return 'triggers';
  if (action === 'preview') return 'search';
  return 'info';
}

export function targetLabel(action: string): string {
  return action.includes('agent-disconnect') ? 'Agent' : 'Container';
}

export function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return isoString;
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const d = new Date(isoString);
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
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function formatAbsoluteTime(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Format an ISO timestamp as a compact relative age string (e.g. "3d", "2w", "5mo", "1y"). */
export function imageAge(isoString: string | undefined): string {
  if (!isoString) return '\u2014';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '\u2014';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${Math.max(1, diffMin)}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffDay < 60) return `${diffWeek}w`;
  const diffMonth = Math.floor(diffDay / 30.44);
  if (diffMonth < 12) return `${diffMonth}mo`;
  const diffYear = Math.floor(diffDay / 365.25);
  return `${diffYear}y`;
}
