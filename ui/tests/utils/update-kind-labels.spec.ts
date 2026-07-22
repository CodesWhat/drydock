import {
  getUpdateKindLabel,
  hasUnresolvedUpdateKind,
  UPDATE_KIND_LABEL_KEYS,
} from '@/utils/update-kind-labels';

const mockT = vi.fn((key: string) => key);

describe('update-kind-labels', () => {
  beforeEach(() => {
    mockT.mockClear();
  });

  describe('UPDATE_KIND_LABEL_KEYS', () => {
    it('maps each known kind to its containerComponents.listContent i18n key', () => {
      expect(UPDATE_KIND_LABEL_KEYS.major).toBe('containerComponents.listContent.major');
      expect(UPDATE_KIND_LABEL_KEYS.minor).toBe('containerComponents.listContent.minor');
      expect(UPDATE_KIND_LABEL_KEYS.patch).toBe('containerComponents.listContent.patch');
      expect(UPDATE_KIND_LABEL_KEYS.digest).toBe('containerComponents.listContent.digest');
    });
  });

  describe('hasUnresolvedUpdateKind', () => {
    it('returns false for null', () => {
      expect(hasUnresolvedUpdateKind(null)).toBe(false);
    });

    it('returns false for each known kind', () => {
      expect(hasUnresolvedUpdateKind('major')).toBe(false);
      expect(hasUnresolvedUpdateKind('minor')).toBe(false);
      expect(hasUnresolvedUpdateKind('patch')).toBe(false);
      expect(hasUnresolvedUpdateKind('digest')).toBe(false);
    });

    it('returns true for an unrecognized, present kind', () => {
      expect(hasUnresolvedUpdateKind('bogus-kind' as never)).toBe(true);
    });
  });

  describe('getUpdateKindLabel', () => {
    it('returns empty string for null regardless of t', () => {
      expect(getUpdateKindLabel(null)).toBe('');
      expect(getUpdateKindLabel(null, mockT)).toBe('');
      expect(mockT).not.toHaveBeenCalled();
    });

    it('localizes each known kind via t', () => {
      expect(getUpdateKindLabel('major', mockT)).toBe('containerComponents.listContent.major');
      expect(getUpdateKindLabel('minor', mockT)).toBe('containerComponents.listContent.minor');
      expect(getUpdateKindLabel('patch', mockT)).toBe('containerComponents.listContent.patch');
      expect(getUpdateKindLabel('digest', mockT)).toBe('containerComponents.listContent.digest');
    });

    it('falls back to plain English labels for known kinds when t is omitted', () => {
      expect(getUpdateKindLabel('major')).toBe('Major');
      expect(getUpdateKindLabel('minor')).toBe('Minor');
      expect(getUpdateKindLabel('patch')).toBe('Patch');
      expect(getUpdateKindLabel('digest')).toBe('Image update');
    });

    it('localizes an unresolved kind to the neutral unknown label via t', () => {
      const result = getUpdateKindLabel('bogus-kind' as never, mockT);
      expect(result).toBe('containerComponents.groupedViews.unknownKindLabel');
      expect(mockT).toHaveBeenCalledWith('containerComponents.groupedViews.unknownKindLabel');
    });

    it('falls back to the plain English "Unknown" label for an unresolved kind when t is omitted', () => {
      expect(getUpdateKindLabel('bogus-kind' as never)).toBe('Unknown');
    });
  });
});
