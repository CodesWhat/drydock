import {
  clearLastKnown,
  LAST_KNOWN_KEYS,
  LAST_KNOWN_MAX_AGE_MS,
  LAST_KNOWN_MAX_ENTRY_CHARS,
  readLastKnown,
  saveLastKnown,
} from '@/utils/last-known';

describe('last-known store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a saved value with its timestamp', () => {
    saveLastKnown('containers', [{ id: 'a' }], 1000);

    expect(readLastKnown('containers', 2000)).toEqual({ savedAt: 1000, data: [{ id: 'a' }] });
  });

  it('defaults to the current time', () => {
    saveLastKnown('agents', []);

    const entry = readLastKnown('agents');
    expect(entry?.data).toEqual([]);
    expect(Date.now() - (entry?.savedAt ?? 0)).toBeLessThan(5000);
  });

  it('returns undefined when nothing was saved', () => {
    expect(readLastKnown('containers')).toBeUndefined();
  });

  it('expires entries older than the max age and removes them', () => {
    saveLastKnown('containers', [1], 0);

    expect(readLastKnown('containers', LAST_KNOWN_MAX_AGE_MS + 1)).toBeUndefined();
    expect(localStorage.getItem('dd-last-known-v1:containers')).toBeNull();
  });

  it('keeps entries exactly at the max age', () => {
    saveLastKnown('containers', [1], 0);

    expect(readLastKnown('containers', LAST_KNOWN_MAX_AGE_MS)?.data).toEqual([1]);
  });

  it.each([
    ['not json', '{nope'],
    ['null', 'null'],
    ['missing savedAt', JSON.stringify({ data: 1 })],
    ['missing data', JSON.stringify({ savedAt: 1 })],
  ])('drops a corrupt entry (%s)', (_label, raw) => {
    localStorage.setItem('dd-last-known-v1:containers', raw);

    expect(readLastKnown('containers')).toBeUndefined();
    expect(localStorage.getItem('dd-last-known-v1:containers')).toBeNull();
  });

  it('survives storage that throws on read and on cleanup', () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const removeItem = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readLastKnown('containers')).toBeUndefined();
    expect(() => clearLastKnown()).not.toThrow();

    getItem.mockRestore();
    removeItem.mockRestore();
  });

  it('ignores quota and serialization failures when saving', () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => saveLastKnown('containers', [1])).not.toThrow();

    setItem.mockRestore();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => saveLastKnown('containers', circular)).not.toThrow();
  });

  it('refuses oversized entries and drops the older copy', () => {
    saveLastKnown('containers', [1], 1);

    saveLastKnown('containers', 'x'.repeat(LAST_KNOWN_MAX_ENTRY_CHARS), 2);

    expect(readLastKnown('containers', 3)).toBeUndefined();
  });

  it('clears every known key', () => {
    for (const key of LAST_KNOWN_KEYS) {
      saveLastKnown(key, { key });
    }
    localStorage.setItem('unrelated', 'keep');

    clearLastKnown();

    for (const key of LAST_KNOWN_KEYS) {
      expect(readLastKnown(key)).toBeUndefined();
    }
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});
