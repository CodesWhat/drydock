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

  it('persists via saveRecentItems', () => {
    saveRecentItems('primary', [{ id: 'x', title: 'X' }]);
    expect(localStorage.getItem('primary')).toBe(JSON.stringify([{ id: 'x', title: 'X' }]));
  });
});
