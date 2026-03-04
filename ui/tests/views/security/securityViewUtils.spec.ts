import {
  buildSecurityEmptyState,
  chooseLatestTimestamp,
  computeDelta,
  formatTimestamp,
  highestSeverity,
  normalizeSeverityCount,
  toSafeFileName,
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
  });

  describe('computeDelta', () => {
    it('computes fixed/new counters across severities', () => {
      expect(
        computeDelta(
          { critical: 3, high: 2, medium: 4, low: 1 },
          { critical: 1, high: 3, medium: 2, low: 1, unknown: 0 },
        ),
      ).toEqual({
        fixed: 4,
        new: 1,
        fixedCritical: 2,
        fixedHigh: 0,
        newCritical: 0,
        newHigh: 1,
      });
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
});
