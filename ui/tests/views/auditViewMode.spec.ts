import { parseAuditViewModeQuery, resolveAuditViewModeFromQuery } from '@/views/auditViewMode';

describe('auditViewMode helpers', () => {
  describe('parseAuditViewModeQuery', () => {
    it('parses valid view modes', () => {
      expect(parseAuditViewModeQuery('table')).toBe('table');
      expect(parseAuditViewModeQuery('cards')).toBe('cards');
      expect(parseAuditViewModeQuery('list')).toBe('list');
    });

    it('falls back to table for invalid values', () => {
      expect(parseAuditViewModeQuery('grid')).toBe('table');
      expect(parseAuditViewModeQuery(undefined)).toBe('table');
      expect(parseAuditViewModeQuery(['cards', 'list'])).toBe('cards');
    });
  });

  describe('resolveAuditViewModeFromQuery', () => {
    it('keeps current mode when query omits view', () => {
      expect(resolveAuditViewModeFromQuery('cards', undefined)).toBe('cards');
    });

    it('uses query mode when present', () => {
      expect(resolveAuditViewModeFromQuery('cards', 'list')).toBe('list');
    });

    it('falls back to table for invalid explicit query values', () => {
      expect(resolveAuditViewModeFromQuery('cards', 'grid')).toBe('table');
    });
  });
});
