import { distinctBuild } from '@/utils/build-identity';

describe('distinctBuild', () => {
  it('returns the build when it differs from the version', () => {
    expect(distinctBuild('1.6.1', '1.6.1-rc.15')).toBe('1.6.1-rc.15');
  });

  it('returns undefined when the build matches the version', () => {
    expect(distinctBuild('1.6.1', '1.6.1')).toBeUndefined();
    expect(distinctBuild('ci', 'ci')).toBeUndefined();
  });

  it('returns undefined when an older server or agent reports no build', () => {
    expect(distinctBuild('1.6.1-rc.15', undefined)).toBeUndefined();
    expect(distinctBuild('1.6.1-rc.15', null)).toBeUndefined();
  });

  it('returns undefined for an empty or non-string build', () => {
    expect(distinctBuild('1.6.1', '')).toBeUndefined();
    expect(distinctBuild('1.6.1', 42)).toBeUndefined();
    expect(distinctBuild('1.6.1', { build: '1.6.1-rc.15' })).toBeUndefined();
  });

  it('returns the build when the version is missing', () => {
    expect(distinctBuild(undefined, '1.6.1-rc.15')).toBe('1.6.1-rc.15');
  });
});
