import { loadRecentItems, saveRecentItems } from '@/layouts/recentStorage';

interface RecentItem {
  id: string;
  title: string;
}

function isRecentItem(v: unknown): v is RecentItem {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    typeof (v as Record<string, unknown>).title === 'string'
  );
}

describe('recentStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns items from the primary key when present', () => {
    localStorage.setItem('primary', JSON.stringify([{ id: 'a', title: 'A' }]));

    const result = loadRecentItems({
      key: 'primary',
      legacyKey: 'legacy',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([{ id: 'a', title: 'A' }]);
  });

  it('migrates items from the legacy key when the primary key is missing', () => {
    localStorage.setItem('legacy', JSON.stringify([{ id: 'b', title: 'B' }]));

    const result = loadRecentItems({
      key: 'primary',
      legacyKey: 'legacy',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([{ id: 'b', title: 'B' }]);
    expect(localStorage.getItem('primary')).toBe(JSON.stringify([{ id: 'b', title: 'B' }]));
    expect(localStorage.getItem('legacy')).toBeNull();
  });

  it('does not persist migrated legacy values when none pass validation', () => {
    localStorage.setItem('legacy', JSON.stringify([{ invalid: true }]));

    const result = loadRecentItems({
      key: 'primary',
      legacyKey: 'legacy',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([]);
    expect(localStorage.getItem('primary')).toBeNull();
    expect(localStorage.getItem('legacy')).toBeNull();
  });

  it('does not read legacy values when primary key already exists (even empty)', () => {
    localStorage.setItem('primary', JSON.stringify([]));
    localStorage.setItem('legacy', JSON.stringify([{ id: 'c', title: 'C' }]));

    const result = loadRecentItems({
      key: 'primary',
      legacyKey: 'legacy',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([]);
    expect(localStorage.getItem('legacy')).toBe(JSON.stringify([{ id: 'c', title: 'C' }]));
  });

  it('caps loaded arrays to maxItems', () => {
    localStorage.setItem(
      'primary',
      JSON.stringify([
        { id: '1', title: '1' },
        { id: '2', title: '2' },
        { id: '3', title: '3' },
      ]),
    );

    const result = loadRecentItems({
      key: 'primary',
      maxItems: 2,
      validate: isRecentItem,
    });

    expect(result).toEqual([
      { id: '1', title: '1' },
      { id: '2', title: '2' },
    ]);
  });

  it('returns an empty list when persisted value is not an array', () => {
    localStorage.setItem('primary', JSON.stringify({ id: 'x' }));

    const result = loadRecentItems({
      key: 'primary',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([]);
  });

  it('returns an empty list when persisted JSON cannot be parsed', () => {
    localStorage.setItem('primary', '{broken');

    const result = loadRecentItems({
      key: 'primary',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([]);
  });

  it('returns empty when no primary value exists and no legacy key is configured', () => {
    const result = loadRecentItems({
      key: 'primary',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([]);
  });

  it('returns empty when neither primary nor legacy keys exist', () => {
    const result = loadRecentItems({
      key: 'primary',
      legacyKey: 'legacy',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([]);
  });

  it('persists via saveRecentItems', () => {
    saveRecentItems('primary', [{ id: 'x', title: 'X' }]);
    expect(localStorage.getItem('primary')).toBe(JSON.stringify([{ id: 'x', title: 'X' }]));
  });

  it('ignores storage write failures in saveRecentItems', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => saveRecentItems('primary', [{ id: 'x', title: 'X' }])).not.toThrow();
    spy.mockRestore();
  });

  it('still migrates legacy values when legacy key removal fails', () => {
    localStorage.setItem('legacy', JSON.stringify([{ id: 'z', title: 'Z' }]));
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const result = loadRecentItems({
      key: 'primary',
      legacyKey: 'legacy',
      maxItems: 8,
      validate: isRecentItem,
    });

    expect(result).toEqual([{ id: 'z', title: 'Z' }]);
    expect(localStorage.getItem('primary')).toBe(JSON.stringify([{ id: 'z', title: 'Z' }]));
    removeSpy.mockRestore();
  });
});
