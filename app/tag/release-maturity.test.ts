import { getReleaseMaturityEvidence } from './version-population.js';

const sources = (tags: string[]) => tags.map((tag) => ({ tag, versionTag: tag }));
const evidence = (version: string, tags: string[]) =>
  getReleaseMaturityEvidence(version, sources(tags));

describe('release-family maturity evidence', () => {
  test('counts earlier distinct stable releases within a CalVer month', () => {
    expect(
      evidence('2026.8.2', ['2026.7.9', '2026.8.0', '2026.8.1', '2026.8.2', '2026.9.0']),
    ).toEqual({ version: '2026.8.2', family: '2026.8', earlierReleases: 2 });
  });

  test('counts within a SemVer major, including earlier minors', () => {
    expect(evidence('9.1.2', ['8.9.9', '9.0.0', '9.1.0', '9.1.2', '9.2.0', '10.0.0'])).toEqual({
      version: '9.1.2',
      family: '9',
      earlierReleases: 2,
    });
  });

  test('deduplicates aliases and build metadata and excludes moving short aliases', () => {
    expect(
      evidence('v2.0.2+vendor.5', [
        '2',
        '2.0',
        '2.0.0',
        'v2.0.0',
        '2.0.0+build.2',
        '2.0.1',
        '2.0.2',
      ]),
    ).toEqual({ version: '2.0.2', family: '2', earlierReleases: 2 });
  });

  test('does not invent releases in version gaps or count later releases', () => {
    expect(evidence('2.0.8', ['2.0.0', '2.0.8', '2.0.9'])).toEqual({
      version: '2.0.8',
      family: '2',
      earlierReleases: 1,
    });
  });

  test('does not count prereleases, lossy coercions, build counters or OS variants', () => {
    expect(
      evidence('2.1.0', [
        '2.0.0-rc.1',
        '2.0.0.dev1',
        '2.0.0-alpine',
        'image-2.0.0',
        '200',
        '2',
        '2.0',
      ]),
    ).toEqual({ version: '2.1.0', family: '2', earlierReleases: 0 });
  });

  test('uses transformed classification values while deduplicating raw tags', () => {
    expect(
      getReleaseMaturityEvidence('2.0.2', [
        { tag: 'release-2.0.0', versionTag: '2.0.0' },
        { tag: 'v2.0.0', versionTag: '2.0.0' },
        { tag: 'release-2.0.1', versionTag: '2.0.1' },
      ]),
    ).toEqual({ version: '2.0.2', family: '2', earlierReleases: 2 });
  });

  test('normalizes numeric CalVer components with leading zeroes', () => {
    expect(evidence('2026.08.02', ['2026.08.00', '2026.8.0', '2026.08.01'])).toEqual({
      version: '2026.8.2',
      family: '2026.8',
      earlierReleases: 2,
    });
  });

  test.each([
    'latest',
    'beta',
    '9',
    '9.1',
    '9.1.0-rc.1',
    '9.1.0-alpine',
    '9.1.0.dev1',
    'v9.1.0.4',
    '',
    '99999999999999999.0.0',
  ])('leaves unsequenceable candidate %s unavailable', (version) => {
    expect(evidence(version, ['9.0.0', '9.1.0'])).toBeUndefined();
  });
});
