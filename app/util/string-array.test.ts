import { byString } from 'sort-es';
import { describe, expect, test } from 'vitest';
import { uniqStrings } from './string-array.js';

describe('uniqStrings', () => {
  test('returns unique string values and preserves insertion order by default', () => {
    expect(uniqStrings(['beta', 3, 'alpha', 'beta', '', null, 'alpha'])).toEqual([
      'beta',
      'alpha',
      '',
    ]);
  });

  test('returns an empty array for non-array inputs', () => {
    expect(uniqStrings(undefined)).toEqual([]);
    expect(uniqStrings('not-an-array')).toEqual([]);
  });

  test('can trim, drop empty values, and sort', () => {
    expect(
      uniqStrings([' smtp.ops ', 'slack.ops', 'smtp.ops', '', '   ', 'slack.ops'], {
        trim: true,
        removeEmpty: true,
        sortComparator: byString(),
      }),
    ).toEqual(['slack.ops', 'smtp.ops']);
  });
});
