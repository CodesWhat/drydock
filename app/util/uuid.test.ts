import { describe, expect, test, vi } from 'vitest';
import { uuidv7 } from './uuid.js';

describe('uuidv7', () => {
  const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  test('matches the RFC 9562 v7 layout', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(uuidv7()).toMatch(UUID_V7_PATTERN);
    }
  });

  test('encodes the current unix timestamp in the leading 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();

    const timestampHex = `${id.slice(0, 8)}${id.slice(9, 13)}`;
    const timestamp = Number.parseInt(timestampHex, 16);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  test('produces string-sort-ordered ids when timestamps are monotonic', () => {
    let fakeNow = 1_700_000_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    try {
      const ids: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        ids.push(uuidv7());
        fakeNow += 1;
      }
      const sorted = [...ids].sort();
      expect(sorted).toEqual(ids);
    } finally {
      spy.mockRestore();
    }
  });

  test('produces unique ids across rapid successive calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      seen.add(uuidv7());
    }
    expect(seen.size).toBe(5000);
  });

  test('always sets the version nibble to 7', () => {
    for (let i = 0; i < 20; i += 1) {
      const id = uuidv7();
      expect(id[14]).toBe('7');
    }
  });

  test('always sets the variant bits to the RFC 9562 10xx pattern', () => {
    for (let i = 0; i < 20; i += 1) {
      const id = uuidv7();
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
  });
});
