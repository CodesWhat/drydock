import { describe, expect, test } from 'vitest';
import { RingBuffer } from './ring-buffer.js';

describe('stats/ring-buffer', () => {
  test('stores values in insertion order when not full', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([1, 2]);
    expect(buffer.getLatest()).toBe(2);
  });

  test('overwrites oldest values when capacity is exceeded', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);
    buffer.push(5);

    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.getLatest()).toBe(5);
  });

  test('returns undefined as latest when empty', () => {
    const buffer = new RingBuffer<number>(3);
    expect(buffer.getLatest()).toBeUndefined();
    expect(buffer.toArray()).toEqual([]);
  });

  test('normalizes invalid capacity to one', () => {
    const buffer = new RingBuffer<number>(0);
    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([2]);
    expect(buffer.getLatest()).toBe(2);
  });

  test('normalizes non-finite capacity to one', () => {
    const buffer = new RingBuffer<number>(Number.NaN);
    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([2]);
    expect(buffer.getLatest()).toBe(2);
  });
});
