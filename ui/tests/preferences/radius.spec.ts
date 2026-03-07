import { applyRadius, RADIUS_PRESET_VALUES } from '@/preferences/radius';

describe('radius preferences', () => {
  it('exports expected radius presets', () => {
    expect(RADIUS_PRESET_VALUES.map((preset) => preset.id)).toEqual([
      'none',
      'sharp',
      'modern',
      'soft',
      'round',
    ]);
  });

  it('applies css variables for a known preset', () => {
    const setPropertySpy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyRadius('soft');

    expect(setPropertySpy).toHaveBeenCalledWith('--dd-radius', '12px');
    expect(setPropertySpy).toHaveBeenCalledWith('--dd-radius-sm', '6px');
    expect(setPropertySpy).toHaveBeenCalledWith('--dd-radius-lg', '16px');
    setPropertySpy.mockRestore();
  });

  it('applies css variables for sharp preset', () => {
    const setPropertySpy = vi.spyOn(document.documentElement.style, 'setProperty');

    applyRadius('sharp');

    expect(setPropertySpy).toHaveBeenCalledWith('--dd-radius', '3px');
    expect(setPropertySpy).toHaveBeenCalledWith('--dd-radius-sm', '2px');
    expect(setPropertySpy).toHaveBeenCalledWith('--dd-radius-lg', '4px');
    setPropertySpy.mockRestore();
  });
});
