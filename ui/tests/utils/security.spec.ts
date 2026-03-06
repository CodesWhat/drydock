import { normalizeSeverity } from '@/utils/security';

describe('security utils', () => {
  describe('normalizeSeverity', () => {
    it('normalizes known severities to uppercase', () => {
      expect(normalizeSeverity('critical')).toBe('CRITICAL');
      expect(normalizeSeverity('HIGH')).toBe('HIGH');
      expect(normalizeSeverity('Medium')).toBe('MEDIUM');
      expect(normalizeSeverity('low')).toBe('LOW');
    });

    it('returns UNKNOWN for unsupported values', () => {
      expect(normalizeSeverity('negligible')).toBe('UNKNOWN');
      expect(normalizeSeverity('')).toBe('UNKNOWN');
      expect(normalizeSeverity(null)).toBe('UNKNOWN');
      expect(normalizeSeverity(undefined)).toBe('UNKNOWN');
      expect(normalizeSeverity(3)).toBe('UNKNOWN');
    });
  });
});
