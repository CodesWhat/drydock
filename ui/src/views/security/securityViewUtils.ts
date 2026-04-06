import type {
  SecurityEmptyState,
  SecurityRuntimeToolStatus,
  SecurityViewEmptyStateInput,
  SeveritySummaryCounts,
  Vulnerability,
} from './securityViewTypes';

export const severityOrder: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

export function severityColor(sev: string) {
  if (sev === 'CRITICAL') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  if (sev === 'HIGH') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  if (sev === 'MEDIUM') return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)' };
  return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
}

export function severityIcon(sev: string): string {
  if (sev === 'CRITICAL') return 'warning';
  if (sev === 'HIGH') return 'chevrons-up';
  if (sev === 'MEDIUM') return 'neutral';
  return 'chevron-down';
}

export function statusBadgeTone(status: SecurityRuntimeToolStatus['status']) {
  if (status === 'ready') {
    return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' };
  }
  if (status === 'missing') {
    return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  }
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
}

export function chooseLatestTimestamp(current: string | null, candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  const currentDate = new Date(current);
  const candidateDate = new Date(candidate);
  if (Number.isNaN(candidateDate.getTime())) {
    return current;
  }
  if (Number.isNaN(currentDate.getTime())) {
    return candidate;
  }
  return candidateDate.getTime() > currentDate.getTime() ? candidate : current;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

export function normalizeSeverityCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

export function fixablePercent(fixable: number, total: number): string {
  if (total <= 0) return '0';
  const pct = (fixable / total) * 100;
  return pct === 100 || pct === 0 ? String(pct) : pct.toFixed(1).replace(/\.0$/, '');
}

export function fixableColor(fixable: number, total: number): string {
  if (total <= 0) return 'var(--dd-neutral)';
  const pct = (fixable / total) * 100;
  if (pct >= 90) return 'var(--dd-success)';
  if (pct >= 60) return 'var(--dd-caution)';
  return 'var(--dd-warning)';
}

export function highestSeverity(summary: SeveritySummaryCounts): string {
  if (summary.critical > 0) return 'CRITICAL';
  if (summary.high > 0) return 'HIGH';
  if (summary.medium > 0) return 'MEDIUM';
  return 'LOW';
}

export function toSafeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function toSafeExternalUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return null;
  }

  try {
    const url = new URL(trimmedValue);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return trimmedValue;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildSecurityEmptyState(input: SecurityViewEmptyStateInput): SecurityEmptyState {
  if (!input.hasVulnerabilityData) {
    if (input.scannerSetupNeeded) {
      return {
        title: 'No vulnerability data yet',
        description: input.scannerMessage || 'Scanner is not ready yet.',
        showSetupGuide: true,
        showScanButton: false,
      };
    }

    return {
      title: 'No vulnerability data yet',
      description: 'Run a scan to check your containers for known vulnerabilities',
      showSetupGuide: false,
      showScanButton: true,
    };
  }

  return {
    title: 'No images match your filters',
    description: null,
    showSetupGuide: false,
    showScanButton: false,
  };
}

export type VulnExportFormat = 'json' | 'csv';

function escapeCsvField(value: string): string {
  const sanitizedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (
    sanitizedValue.includes(',') ||
    sanitizedValue.includes('"') ||
    sanitizedValue.includes('\n')
  ) {
    return `"${sanitizedValue.replace(/"/g, '""')}"`;
  }
  return sanitizedValue;
}

const VULN_CSV_COLUMNS = [
  'ID',
  'Severity',
  'Package',
  'Version',
  'Fixed In',
  'Title',
  'Target',
  'URL',
] as const;

export function vulnReportToCsv(vulns: Vulnerability[]): string {
  const rows = [VULN_CSV_COLUMNS.join(',')];
  for (const v of vulns) {
    rows.push(
      [
        escapeCsvField(v.id),
        escapeCsvField(v.severity),
        escapeCsvField(v.package),
        escapeCsvField(v.version),
        escapeCsvField(v.fixedIn ?? ''),
        escapeCsvField(v.title ?? ''),
        escapeCsvField(v.target ?? ''),
        escapeCsvField(v.primaryUrl ?? ''),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function vulnReportToJson(vulns: Vulnerability[]): string {
  const exported = vulns.map((v) => ({
    id: v.id,
    severity: v.severity,
    package: v.package,
    version: v.version,
    fixedIn: v.fixedIn,
    title: v.title ?? null,
    target: v.target ?? null,
    url: v.primaryUrl ?? null,
  }));
  return JSON.stringify(exported, null, 2);
}
