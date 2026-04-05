import type { Vulnerability } from '@/views/security/securityViewTypes';
import {
  buildSecurityEmptyState,
  chooseLatestTimestamp,
  fixableColor,
  fixablePercent,
  formatTimestamp,
  highestSeverity,
  normalizeSeverityCount,
  severityColor,
  severityIcon,
  statusBadgeTone,
  toSafeFileName,
  vulnReportToCsv,
  vulnReportToJson,
} from '@/views/security/securityViewUtils';

describe('securityViewUtils', () => {
  describe('chooseLatestTimestamp', () => {
    it('returns the candidate when current is null', () => {
      expect(chooseLatestTimestamp(null, '2026-03-01T10:00:00.000Z')).toBe(
        '2026-03-01T10:00:00.000Z',
      );
    });

    it('keeps current when candidate is invalid', () => {
      expect(chooseLatestTimestamp('2026-03-01T10:00:00.000Z', 'not-a-date')).toBe(
        '2026-03-01T10:00:00.000Z',
      );
    });

    it('returns the latest valid timestamp', () => {
      expect(chooseLatestTimestamp('2026-03-01T10:00:00.000Z', '2026-03-02T10:00:00.000Z')).toBe(
        '2026-03-02T10:00:00.000Z',
      );
    });

    it('keeps current when candidate is older than current', () => {
      expect(chooseLatestTimestamp('2026-03-03T10:00:00.000Z', '2026-03-02T10:00:00.000Z')).toBe(
        '2026-03-03T10:00:00.000Z',
      );
    });

    it('returns candidate when current timestamp is invalid', () => {
      expect(chooseLatestTimestamp('not-a-date', '2026-03-02T10:00:00.000Z')).toBe(
        '2026-03-02T10:00:00.000Z',
      );
    });
  });

  describe('buildSecurityEmptyState', () => {
    it('returns scan setup state when scanner setup is needed and no vulnerabilities are loaded', () => {
      expect(
        buildSecurityEmptyState({
          hasVulnerabilityData: false,
          scannerSetupNeeded: true,
          scannerMessage: 'Trivy missing from PATH',
        }),
      ).toEqual({
        title: 'No vulnerability data yet',
        description: 'Trivy missing from PATH',
        showSetupGuide: true,
        showScanButton: false,
      });
    });

    it('falls back to default scanner setup message when none is provided', () => {
      expect(
        buildSecurityEmptyState({
          hasVulnerabilityData: false,
          scannerSetupNeeded: true,
          scannerMessage: '',
        }),
      ).toEqual({
        title: 'No vulnerability data yet',
        description: 'Scanner is not ready yet.',
        showSetupGuide: true,
        showScanButton: false,
      });
    });

    it('returns scan CTA when scanner is ready and no vulnerabilities are loaded', () => {
      expect(
        buildSecurityEmptyState({
          hasVulnerabilityData: false,
          scannerSetupNeeded: false,
          scannerMessage: '',
        }),
      ).toEqual({
        title: 'No vulnerability data yet',
        description: 'Run a scan to check your containers for known vulnerabilities',
        showSetupGuide: false,
        showScanButton: true,
      });
    });

    it('returns filter-empty state when vulnerabilities exist but are filtered out', () => {
      expect(
        buildSecurityEmptyState({
          hasVulnerabilityData: true,
          scannerSetupNeeded: false,
          scannerMessage: 'ignored',
        }),
      ).toEqual({
        title: 'No images match your filters',
        description: null,
        showSetupGuide: false,
        showScanButton: false,
      });
    });
  });

  describe('severity helpers', () => {
    it('maps severities to badge colors', () => {
      expect(severityColor('CRITICAL')).toEqual({
        bg: 'var(--dd-danger-muted)',
        text: 'var(--dd-danger)',
      });
      expect(severityColor('HIGH')).toEqual({
        bg: 'var(--dd-warning-muted)',
        text: 'var(--dd-warning)',
      });
      expect(severityColor('MEDIUM')).toEqual({
        bg: 'var(--dd-caution-muted)',
        text: 'var(--dd-caution)',
      });
      expect(severityColor('LOW')).toEqual({
        bg: 'var(--dd-info-muted)',
        text: 'var(--dd-info)',
      });
    });

    it('maps severities to icon names', () => {
      expect(severityIcon('CRITICAL')).toBe('warning');
      expect(severityIcon('HIGH')).toBe('chevrons-up');
      expect(severityIcon('MEDIUM')).toBe('neutral');
      expect(severityIcon('LOW')).toBe('chevron-down');
    });

    it('maps runtime tool status to badge tone', () => {
      expect(statusBadgeTone('ready')).toEqual({
        bg: 'var(--dd-success-muted)',
        text: 'var(--dd-success)',
      });
      expect(statusBadgeTone('missing')).toEqual({
        bg: 'var(--dd-danger-muted)',
        text: 'var(--dd-danger)',
      });
      expect(statusBadgeTone('disabled')).toEqual({
        bg: 'var(--dd-neutral-muted)',
        text: 'var(--dd-neutral)',
      });
    });
  });

  describe('fixable helpers', () => {
    it('formats fixable percentages with zero/whole/decimal behavior', () => {
      expect(fixablePercent(0, 0)).toBe('0');
      expect(fixablePercent(0, 20)).toBe('0');
      expect(fixablePercent(20, 20)).toBe('100');
      expect(fixablePercent(6, 8)).toBe('75');
      expect(fixablePercent(1, 3)).toBe('33.3');
    });

    it('selects fixable ratio color by thresholds', () => {
      expect(fixableColor(0, 0)).toBe('var(--dd-neutral)');
      expect(fixableColor(90, 100)).toBe('var(--dd-success)');
      expect(fixableColor(60, 100)).toBe('var(--dd-caution)');
      expect(fixableColor(59, 100)).toBe('var(--dd-warning)');
    });
  });

  describe('misc', () => {
    it('normalizes severity counts to non-negative integers', () => {
      expect(normalizeSeverityCount(3.8)).toBe(3);
      expect(normalizeSeverityCount(-1)).toBe(0);
      expect(normalizeSeverityCount('3')).toBe(0);
    });

    it('formats timestamps as iso strings when parseable', () => {
      expect(formatTimestamp('2026-03-01T10:00:00Z')).toBe('2026-03-01T10:00:00.000Z');
      expect(formatTimestamp('not-a-date')).toBe('not-a-date');
      expect(formatTimestamp(undefined)).toBe('unknown');
    });

    it('returns highest severity for an image summary', () => {
      expect(highestSeverity({ critical: 1, high: 0, medium: 0, low: 0 })).toBe('CRITICAL');
      expect(highestSeverity({ critical: 0, high: 1, medium: 0, low: 0 })).toBe('HIGH');
      expect(highestSeverity({ critical: 0, high: 0, medium: 1, low: 0 })).toBe('MEDIUM');
      expect(highestSeverity({ critical: 0, high: 0, medium: 0, low: 5 })).toBe('LOW');
    });

    it('sanitizes filenames for sbom downloads', () => {
      expect(toSafeFileName('ghcr.io/org/image:1.2.3')).toBe('ghcr.io-org-image-1.2.3');
    });
  });

  describe('vulnReportToCsv', () => {
    const baseVuln: Vulnerability = {
      id: 'CVE-2026-1234',
      severity: 'HIGH',
      package: 'openssl',
      version: '1.1.1',
      fixedIn: '1.1.2',
      title: 'Buffer overflow',
      target: 'usr/lib/libssl.so',
      primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1234',
      image: 'nginx:latest',
      publishedDate: '2026-01-15',
    };

    it('returns only header row for empty array', () => {
      expect(vulnReportToCsv([])).toBe('ID,Severity,Package,Version,Fixed In,Title,Target,URL');
    });

    it('formats a single vulnerability as CSV', () => {
      const csv = vulnReportToCsv([baseVuln]);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe(
        'CVE-2026-1234,HIGH,openssl,1.1.1,1.1.2,Buffer overflow,usr/lib/libssl.so,https://nvd.nist.gov/vuln/detail/CVE-2026-1234',
      );
    });

    it('handles null and undefined optional fields', () => {
      const vuln: Vulnerability = {
        ...baseVuln,
        fixedIn: null,
        title: undefined,
        target: undefined,
        primaryUrl: undefined,
      };
      const csv = vulnReportToCsv([vuln]);
      const lines = csv.split('\n');
      expect(lines[1]).toBe('CVE-2026-1234,HIGH,openssl,1.1.1,,,,');
    });

    it('escapes fields containing commas and quotes', () => {
      const vuln: Vulnerability = {
        ...baseVuln,
        title: 'Overflow, use-after-free',
        package: 'lib"ssl"',
      };
      const csv = vulnReportToCsv([vuln]);
      const lines = csv.split('\n');
      expect(lines[1]).toContain('"Overflow, use-after-free"');
      expect(lines[1]).toContain('"lib""ssl"""');
    });
  });

  describe('vulnReportToJson', () => {
    const baseVuln: Vulnerability = {
      id: 'CVE-2026-5678',
      severity: 'CRITICAL',
      package: 'zlib',
      version: '1.2.11',
      fixedIn: '1.2.12',
      title: 'Heap corruption',
      target: 'usr/lib/libz.so',
      primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-5678',
      image: 'alpine:3.18',
      publishedDate: '2026-02-20',
    };

    it('returns empty array json for no vulns', () => {
      expect(vulnReportToJson([])).toBe('[]');
    });

    it('exports fields in the expected shape', () => {
      const parsed = JSON.parse(vulnReportToJson([baseVuln]));
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        id: 'CVE-2026-5678',
        severity: 'CRITICAL',
        package: 'zlib',
        version: '1.2.11',
        fixedIn: '1.2.12',
        title: 'Heap corruption',
        target: 'usr/lib/libz.so',
        url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-5678',
      });
    });

    it('maps missing optional fields to null', () => {
      const vuln: Vulnerability = {
        ...baseVuln,
        fixedIn: null,
        title: undefined,
        target: undefined,
        primaryUrl: undefined,
      };
      const parsed = JSON.parse(vulnReportToJson([vuln]));
      expect(parsed[0].fixedIn).toBeNull();
      expect(parsed[0].title).toBeNull();
      expect(parsed[0].target).toBeNull();
      expect(parsed[0].url).toBeNull();
    });

    it('excludes image and publishedDate from export', () => {
      const parsed = JSON.parse(vulnReportToJson([baseVuln]));
      expect(parsed[0]).not.toHaveProperty('image');
      expect(parsed[0]).not.toHaveProperty('publishedDate');
    });
  });
});
