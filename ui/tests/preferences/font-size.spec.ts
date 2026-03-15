import {
  applyFontSize,
  clearFontSizeClasses,
  FONT_SIZE_CLASS_PREFIX,
  FONT_SIZE_SCALE_VALUES,
  fontSizeClassForScale,
  normalizeFontSizeScale,
} from '@/preferences/font-size';

describe('font size preferences', () => {
  const classNames = FONT_SIZE_SCALE_VALUES.map(
    (scale) => `${FONT_SIZE_CLASS_PREFIX}${Math.round(scale * 100)}`,
  );

  beforeEach(() => {
    document.documentElement.classList.remove(...classNames);
  });

  it('exports expected scale values', () => {
    expect(FONT_SIZE_SCALE_VALUES[0]).toBe(0.8);
    expect(FONT_SIZE_SCALE_VALUES.at(-1)).toBe(1.3);
    expect(FONT_SIZE_SCALE_VALUES).toHaveLength(11);
  });

  it('normalizes values to range and configured increments', () => {
    expect(normalizeFontSizeScale(Number.NaN)).toBe(1);
    expect(normalizeFontSizeScale(0.76)).toBe(0.8);
    expect(normalizeFontSizeScale(1.34)).toBe(1.3);
    expect(normalizeFontSizeScale(1.23)).toBe(1.25);
  });

  it('builds class names from normalized scales', () => {
    expect(fontSizeClassForScale(1)).toBe('dd-font-size-100');
    expect(fontSizeClassForScale(1.249)).toBe('dd-font-size-125');
    expect(fontSizeClassForScale(0.799)).toBe('dd-font-size-80');
  });

  it('clears all known font-size classes from a target element', () => {
    const el = document.createElement('div');
    el.classList.add('dd-font-size-80', 'dd-font-size-110', 'other-class');

    clearFontSizeClasses(el);

    expect(el.classList.contains('dd-font-size-80')).toBe(false);
    expect(el.classList.contains('dd-font-size-110')).toBe(false);
    expect(el.classList.contains('other-class')).toBe(true);
  });

  it('applies normalized classes to the root element', () => {
    document.documentElement.classList.add('dd-font-size-80');

    const normalized = applyFontSize(1.24);

    expect(normalized).toBe(1.25);
    expect(document.documentElement.classList.contains('dd-font-size-125')).toBe(true);
    expect(document.documentElement.classList.contains('dd-font-size-80')).toBe(false);
  });
});
