import { applyRadius, RADIUS_PRESET_VALUES } from '@/preferences/radius';

describe('radius preferences', () => {
  const allRadiusClasses = RADIUS_PRESET_VALUES.map((preset) => `dd-radius-${preset.id}`);

  beforeEach(() => {
    document.documentElement.classList.remove(...allRadiusClasses);
  });

  it('exports expected radius presets', () => {
    expect(RADIUS_PRESET_VALUES.map((preset) => preset.id)).toEqual([
      'none',
      'sharp',
      'modern',
      'soft',
      'round',
    ]);
  });

  it('applies the expected class for a known preset and clears stale classes', () => {
    document.documentElement.classList.add('dd-radius-sharp');
    applyRadius('soft');

    expect(document.documentElement.classList.contains('dd-radius-soft')).toBe(true);
    expect(document.documentElement.classList.contains('dd-radius-sharp')).toBe(false);
  });

  it('applies the sharp class', () => {
    applyRadius('sharp');

    expect(document.documentElement.classList.contains('dd-radius-sharp')).toBe(true);
    expect(
      allRadiusClasses.filter((name) => document.documentElement.classList.contains(name)),
    ).toEqual(['dd-radius-sharp']);
  });
});
