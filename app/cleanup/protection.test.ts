const { mockGetAllBackups } = vi.hoisted(() => ({ mockGetAllBackups: vi.fn() }));
vi.mock('../store/backup.js', () => ({ getAllBackups: mockGetAllBackups }));

import { HOUR, NOW } from './cleanup.test.helpers.js';
import {
  buildRollbackImageProtection,
  hasExcludeLabel,
  hoursToMs,
  isRecentRollbackContainer,
} from './protection.js';

describe('cleanup protection', () => {
  beforeEach(() => {
    mockGetAllBackups.mockReset().mockReturnValue([]);
  });

  test('hoursToMs converts hours', () => {
    expect(hoursToMs(2)).toBe(2 * HOUR);
  });

  test('hasExcludeLabel only matches dd.cleanup.exclude=true', () => {
    expect(hasExcludeLabel({ 'dd.cleanup.exclude': 'true' })).toBe(true);
    expect(hasExcludeLabel({ 'dd.cleanup.exclude': 'false' })).toBe(false);
    expect(hasExcludeLabel(undefined)).toBe(false);
    expect(hasExcludeLabel(null)).toBe(false);
  });

  test('isRecentRollbackContainer protects -old- containers inside the window only', () => {
    const recent = { Names: [`/web-old-${NOW - 2 * HOUR}`] } as never;
    const stale = { Names: [`/web-old-${NOW - 200 * HOUR}`] } as never;
    expect(isRecentRollbackContainer(recent, 168, NOW)).toBe(true);
    expect(isRecentRollbackContainer(stale, 168, NOW)).toBe(false);
    expect(isRecentRollbackContainer({ Names: ['/web'] } as never, 168, NOW)).toBe(false);
    expect(isRecentRollbackContainer({} as never, 168, NOW)).toBe(false);
  });

  test('buildRollbackImageProtection matches recent backups by tag and digest', () => {
    mockGetAllBackups.mockReturnValue([
      {
        imageName: 'library/nginx',
        imageTag: '1.0',
        imageDigest: 'sha256:aaa',
        timestamp: new Date(NOW - HOUR).toISOString(),
      },
      {
        imageName: 'library/old',
        imageTag: '1',
        imageDigest: 'sha256:bbb',
        timestamp: new Date(NOW - 500 * HOUR).toISOString(),
      },
      {
        imageName: 'nodigest',
        imageTag: 'x',
        timestamp: new Date(NOW - HOUR).toISOString(),
      },
    ]);
    const protection = buildRollbackImageProtection(168, NOW);
    expect(protection.isProtected({ RepoTags: ['docker.io/library/nginx:1.0'] } as never)).toBe(
      true,
    );
    expect(protection.isProtected({ RepoTags: ['library/nginx:1.0'] } as never)).toBe(true);
    expect(
      protection.isProtected({ RepoTags: [], RepoDigests: ['x/nginx@sha256:aaa'] } as never),
    ).toBe(true);
    expect(protection.isProtected({ RepoTags: ['nodigest:x'] } as never)).toBe(true);
    expect(protection.isProtected({ RepoTags: ['library/old:1'] } as never)).toBe(false);
    expect(protection.isProtected({ RepoDigests: ['x/old@sha256:bbb'] } as never)).toBe(false);
    expect(protection.isProtected({} as never)).toBe(false);
  });
});
