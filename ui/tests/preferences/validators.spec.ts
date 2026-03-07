import {
  isValidScale,
  isViewMode,
  RADIUS_PRESETS,
  TABLE_ACTIONS,
  THEME_FAMILIES,
  THEME_VARIANTS,
  VIEW_MODES,
} from '@/preferences/validators';

describe('validators', () => {
  describe('VIEW_MODES', () => {
    it('should contain table, cards, and list', () => {
      expect(VIEW_MODES.has('table')).toBe(true);
      expect(VIEW_MODES.has('cards')).toBe(true);
      expect(VIEW_MODES.has('list')).toBe(true);
    });

    it('should have exactly 3 members', () => {
      expect(VIEW_MODES.size).toBe(3);
    });

    it('should not contain unknown values', () => {
      expect(VIEW_MODES.has('grid' as any)).toBe(false);
    });
  });

  describe('THEME_FAMILIES', () => {
    it('should contain all supported families', () => {
      expect(THEME_FAMILIES.has('one-dark')).toBe(true);
      expect(THEME_FAMILIES.has('github')).toBe(true);
      expect(THEME_FAMILIES.has('dracula')).toBe(true);
      expect(THEME_FAMILIES.has('catppuccin')).toBe(true);
      expect(THEME_FAMILIES.has('gruvbox')).toBe(true);
      expect(THEME_FAMILIES.has('ayu')).toBe(true);
    });

    it('should have exactly 6 members', () => {
      expect(THEME_FAMILIES.size).toBe(6);
    });

    it('should not contain unknown families', () => {
      expect(THEME_FAMILIES.has('monokai')).toBe(false);
    });
  });

  describe('THEME_VARIANTS', () => {
    it('should contain dark, light, and system', () => {
      expect(THEME_VARIANTS.has('dark')).toBe(true);
      expect(THEME_VARIANTS.has('light')).toBe(true);
      expect(THEME_VARIANTS.has('system')).toBe(true);
    });

    it('should have exactly 3 members', () => {
      expect(THEME_VARIANTS.size).toBe(3);
    });

    it('should not contain unknown variants', () => {
      expect(THEME_VARIANTS.has('auto')).toBe(false);
    });
  });

  describe('TABLE_ACTIONS', () => {
    it('should contain icons and buttons', () => {
      expect(TABLE_ACTIONS.has('icons')).toBe(true);
      expect(TABLE_ACTIONS.has('buttons')).toBe(true);
    });

    it('should have exactly 2 members', () => {
      expect(TABLE_ACTIONS.size).toBe(2);
    });

    it('should not contain unknown actions', () => {
      expect(TABLE_ACTIONS.has('links')).toBe(false);
    });
  });

  describe('RADIUS_PRESETS', () => {
    it('should contain all radius presets', () => {
      expect(RADIUS_PRESETS.has('none')).toBe(true);
      expect(RADIUS_PRESETS.has('sharp')).toBe(true);
      expect(RADIUS_PRESETS.has('modern')).toBe(true);
      expect(RADIUS_PRESETS.has('soft')).toBe(true);
      expect(RADIUS_PRESETS.has('round')).toBe(true);
    });

    it('should have exactly 5 members', () => {
      expect(RADIUS_PRESETS.size).toBe(5);
    });

    it('should not contain unknown presets', () => {
      expect(RADIUS_PRESETS.has('pill')).toBe(false);
    });
  });

  describe('isViewMode', () => {
    it('should return true for valid view modes', () => {
      expect(isViewMode('table')).toBe(true);
      expect(isViewMode('cards')).toBe(true);
      expect(isViewMode('list')).toBe(true);
    });

    it('should return false for invalid strings', () => {
      expect(isViewMode('grid')).toBe(false);
      expect(isViewMode('')).toBe(false);
      expect(isViewMode('TABLE')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isViewMode(null)).toBe(false);
      expect(isViewMode(undefined)).toBe(false);
      expect(isViewMode(42)).toBe(false);
      expect(isViewMode(true)).toBe(false);
      expect(isViewMode({})).toBe(false);
      expect(isViewMode([])).toBe(false);
    });
  });

  describe('isValidScale', () => {
    it('should return true for scale values in valid range (0.8 to 1.5)', () => {
      expect(isValidScale(0.8)).toBe(true);
      expect(isValidScale(1)).toBe(true);
      expect(isValidScale(1.0)).toBe(true);
      expect(isValidScale(1.25)).toBe(true);
      expect(isValidScale(1.5)).toBe(true);
    });

    it('should return true for boundary values', () => {
      expect(isValidScale(0.8)).toBe(true);
      expect(isValidScale(1.5)).toBe(true);
    });

    it('should return false for values outside the range', () => {
      expect(isValidScale(0.79)).toBe(false);
      expect(isValidScale(1.51)).toBe(false);
      expect(isValidScale(0)).toBe(false);
      expect(isValidScale(2)).toBe(false);
      expect(isValidScale(-1)).toBe(false);
    });

    it('should return false for non-number values', () => {
      expect(isValidScale(null)).toBe(false);
      expect(isValidScale(undefined)).toBe(false);
      expect(isValidScale('1')).toBe(false);
      expect(isValidScale(true)).toBe(false);
      expect(isValidScale({})).toBe(false);
      expect(isValidScale(NaN)).toBe(false);
    });
  });
});
