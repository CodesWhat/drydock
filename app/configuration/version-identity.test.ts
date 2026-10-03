import { deriveVersionIdentity, formatVersionIdentity } from './version-identity.js';

describe('deriveVersionIdentity', () => {
  test.each([
    ['1.6.1-rc.15', '1.6.1'],
    ['1.7.0-rc.1', '1.7.0'],
    ['1.7.0-beta', '1.7.0'],
    ['10.20.30-alpha.1.2', '10.20.30'],
  ])('strips the prerelease suffix from %s', (configured, base) => {
    expect(deriveVersionIdentity(configured)).toStrictEqual({ version: base, build: configured });
  });

  test('strips prerelease and build metadata together, keeping both in the build', () => {
    expect(deriveVersionIdentity('1.7.0-rc.1+abc')).toStrictEqual({
      version: '1.7.0',
      build: '1.7.0-rc.1+abc',
    });
  });

  test('normalizes a v-prefixed release candidate to the bare base version', () => {
    expect(deriveVersionIdentity('v1.7.0-rc.1')).toStrictEqual({
      version: '1.7.0',
      build: 'v1.7.0-rc.1',
    });
  });

  test.each([
    ['a stable release', '1.6.1'],
    ['a stable release with build metadata', '1.7.0+abc'],
    ['the local build placeholder', 'local'],
    ['the CI build placeholder', 'ci'],
    ['the multi-arch smoke placeholder', 'ci-multiarch-smoke'],
    ['the dev placeholder', 'dev'],
    ['the unresolved placeholder', 'unknown'],
    ['a branch name', 'main'],
    ['a two-segment version', '1.7'],
    ['a dangling prerelease separator', '1.2.3-'],
    ['an empty prerelease identifier', '1.2.3-rc..1'],
    ['a leading-zero version', '01.2.3-rc.1'],
    ['garbage', '!!not a version!!'],
    ['an over-long value', `1.2.3-${'x'.repeat(300)}`],
    ['an empty string', ''],
  ])('passes %s through unchanged', (_label, configured) => {
    expect(deriveVersionIdentity(configured)).toStrictEqual({
      version: configured,
      build: configured,
    });
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { version: '1.0.0-rc.1' }],
  ])('passes %s through unchanged without throwing', (_label, configured) => {
    expect(deriveVersionIdentity(configured)).toStrictEqual({
      version: configured,
      build: configured,
    });
  });
});

describe('formatVersionIdentity', () => {
  test('shows only the version when the build is the same', () => {
    expect(formatVersionIdentity({ version: '1.7.0', build: '1.7.0' })).toBe('1.7.0');
  });

  test('shows the build next to the version when they differ', () => {
    expect(formatVersionIdentity({ version: '1.7.0', build: '1.7.0-rc.17' })).toBe(
      '1.7.0 (build 1.7.0-rc.17)',
    );
  });

  test('formats a derived identity for a promoted release candidate', () => {
    expect(formatVersionIdentity(deriveVersionIdentity('1.6.1-rc.15'))).toBe(
      '1.6.1 (build 1.6.1-rc.15)',
    );
  });

  test('formats a derived identity for a non-semver build', () => {
    expect(formatVersionIdentity(deriveVersionIdentity('local'))).toBe('local');
  });
});
