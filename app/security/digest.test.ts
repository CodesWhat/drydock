import { isImmutableDigest } from './digest.js';

describe('isImmutableDigest', () => {
  test('accepts a lowercase sha256 content digest', () => {
    expect(isImmutableDigest(`sha256:${'a1'.repeat(32)}`)).toBe(true);
  });

  test.each([
    ['a tag the registry fell back to', '2.0.0'],
    ['a short digest', 'sha256:abc'],
    ['uppercase hex', `sha256:${'A'.repeat(64)}`],
    ['another algorithm', `sha512:${'a'.repeat(64)}`],
    ['trailing text', `sha256:${'a'.repeat(64)} `],
    ['undefined', undefined],
    ['a number', 5],
  ])('rejects %s', (_label, value) => {
    expect(isImmutableDigest(value)).toBe(false);
  });
});
