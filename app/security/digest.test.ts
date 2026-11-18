import { isImmutableDigest, isScannedRefPinnedTo } from './digest.js';

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

describe('isScannedRefPinnedTo', () => {
  const digest = `sha256:${'a'.repeat(64)}`;

  test('accepts a digest reference with or without a tag', () => {
    expect(isScannedRefPinnedTo(`registry/app@${digest}`, digest)).toBe(true);
    expect(isScannedRefPinnedTo(`registry/app:1.0@${digest}`, digest)).toBe(true);
  });

  test.each([
    ['a tag reference', 'registry/app:1.0'],
    ['another digest', `registry/app@sha256:${'b'.repeat(64)}`],
    ['a missing reference', undefined],
  ])('rejects %s', (_label, ref) => {
    expect(isScannedRefPinnedTo(ref, digest)).toBe(false);
  });

  test('rejects a digest that is not immutable', () => {
    expect(isScannedRefPinnedTo('registry/app@latest', 'latest')).toBe(false);
  });
});
