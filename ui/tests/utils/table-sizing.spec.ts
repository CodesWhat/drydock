import { normalizeTableColumnSizing, parsePixelSize } from '@/utils/table-sizing';

describe('table sizing utilities', () => {
  it('rejects zero pixel legacy widths', () => {
    expect(parsePixelSize('0px')).toBeNull();
  });

  it('converts percentage legacy widths into flex weights', () => {
    expect(normalizeTableColumnSizing({ key: 'name', width: '25%' }).flex).toBe(0.25);
  });

  it('rejects zero percentage legacy widths as flex weights', () => {
    expect(normalizeTableColumnSizing({ key: 'name', width: '0%' }).flex).toBe(0);
  });
});
