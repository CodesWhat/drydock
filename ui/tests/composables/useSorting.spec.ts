import { useSorting } from '@/composables/useSorting';

describe('useSorting', () => {
  it('should use default key "name" and ascending order', () => {
    const { sortKey, sortAsc } = useSorting();
    expect(sortKey.value).toBe('name');
    expect(sortAsc.value).toBe(true);
  });

  it('should accept a custom default key', () => {
    const { sortKey } = useSorting('status');
    expect(sortKey.value).toBe('status');
  });

  it('should reverse direction when toggling the same key', () => {
    const { sortKey, sortAsc, toggleSort } = useSorting();
    toggleSort('name');
    expect(sortKey.value).toBe('name');
    expect(sortAsc.value).toBe(false);
  });

  it('should reset to ascending when toggling a different key', () => {
    const { sortKey, sortAsc, toggleSort } = useSorting();
    toggleSort('name'); // desc
    toggleSort('status'); // new key, asc
    expect(sortKey.value).toBe('status');
    expect(sortAsc.value).toBe(true);
  });

  it('should handle multiple toggles on the same key', () => {
    const { sortAsc, toggleSort } = useSorting();
    expect(sortAsc.value).toBe(true);
    toggleSort('name');
    expect(sortAsc.value).toBe(false);
    toggleSort('name');
    expect(sortAsc.value).toBe(true);
    toggleSort('name');
    expect(sortAsc.value).toBe(false);
  });

  it('should reset ascending when switching keys after multiple toggles', () => {
    const { sortKey, sortAsc, toggleSort } = useSorting();
    toggleSort('name'); // desc
    toggleSort('name'); // asc
    toggleSort('name'); // desc
    toggleSort('registry'); // new key => asc
    expect(sortKey.value).toBe('registry');
    expect(sortAsc.value).toBe(true);
  });
});
