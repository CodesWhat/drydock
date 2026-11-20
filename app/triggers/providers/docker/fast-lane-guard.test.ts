const mocks = vi.hoisted(() => ({ insertAudit: vi.fn() }));
vi.mock('../../../store/audit.js', () => ({ insertAudit: mocks.insertAudit }));

import { assertFastLaneDigest, FastLaneDigestMismatchError } from './fast-lane-guard.js';

const QUALIFIED = `sha256:${'a'.repeat(64)}`;
const RETAGGED = `sha256:${'b'.repeat(64)}`;
const INDEX = `sha256:${'c'.repeat(64)}`;
const STALE_INDEX = `sha256:${'d'.repeat(64)}`;

function fastLaned(overrides: Record<string, unknown> = {}) {
  return {
    name: 'web',
    watcher: 'local',
    image: { name: 'acme/web' },
    result: { tag: '2.0.0', digest: QUALIFIED },
    securityFastLane: { fixedIds: ['CVE-1'], fixedCount: 1, fixedCritical: 1, fixedHigh: 0 },
    ...overrides,
  } as never;
}

describe('assertFastLaneDigest', () => {
  beforeEach(() => vi.clearAllMocks());

  test('lets the install through when the pulled digest is the qualifying one', () => {
    expect(() =>
      assertFastLaneDigest(fastLaned(), `registry/acme/web:2.0.0@${QUALIFIED}`, false),
    ).not.toThrow();
    expect(mocks.insertAudit).not.toHaveBeenCalled();
  });

  describe('multi-arch candidates', () => {
    const multiArch = (indexDigest: unknown = INDEX) =>
      fastLaned({ result: { tag: '2.0.0', digest: QUALIFIED, indexDigest } });

    test('accepts the manifest list digest a pull by tag records locally', () => {
      expect(() =>
        assertFastLaneDigest(multiArch(), `registry/acme/web:2.0.0@${INDEX}`, false),
      ).not.toThrow();
    });

    test('still accepts the platform digest', () => {
      expect(() =>
        assertFastLaneDigest(multiArch(), `registry/acme/web:2.0.0@${QUALIFIED}`, false),
      ).not.toThrow();
    });

    test('a retag to different content changes the index digest and aborts', () => {
      expect(() =>
        assertFastLaneDigest(multiArch(), `registry/acme/web:2.0.0@${RETAGGED}`, false),
      ).toThrow(FastLaneDigestMismatchError);
      expect(mocks.insertAudit).toHaveBeenCalledTimes(1);
    });

    test('an index digest left over from an older candidate is not accepted', () => {
      expect(() =>
        assertFastLaneDigest(multiArch(), `registry/acme/web:2.0.0@${STALE_INDEX}`, false),
      ).toThrow(FastLaneDigestMismatchError);
    });

    test('an index digest that is not a real digest is never accepted', () => {
      expect(() =>
        assertFastLaneDigest(multiArch('latest'), 'registry/acme/web:2.0.0@latest', false),
      ).toThrow(FastLaneDigestMismatchError);
    });

    test('a single-arch candidate has no index digest and behaves as before', () => {
      expect(() =>
        assertFastLaneDigest(fastLaned(), `registry/acme/web:2.0.0@${INDEX}`, false),
      ).toThrow(FastLaneDigestMismatchError);
    });
  });

  test('aborts and audits when the tag was retagged after the candidate qualified', () => {
    expect(() =>
      assertFastLaneDigest(fastLaned(), `registry/acme/web:2.0.0@${RETAGGED}`, false),
    ).toThrow(FastLaneDigestMismatchError);
    expect(mocks.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security-fast-lane',
        status: 'error',
        containerName: 'local_web',
        containerImage: 'acme/web',
        details: `Security fast lane digest mismatch: pulled digest ${RETAGGED} does not match the qualifying candidate ${QUALIFIED}; install aborted`,
      }),
    );
  });

  test('fails closed when the pulled digest could not be determined', () => {
    expect(() => assertFastLaneDigest(fastLaned(), undefined, false)).toThrow(
      /could not be determined/,
    );
    expect(() => assertFastLaneDigest(fastLaned(), 'registry/acme/web:2.0.0', false)).toThrow(
      FastLaneDigestMismatchError,
    );
    expect(mocks.insertAudit).toHaveBeenCalledTimes(2);
  });

  test('does nothing for a container that is not on the fast lane', () => {
    expect(() =>
      assertFastLaneDigest(
        fastLaned({ securityFastLane: undefined }),
        `registry/acme/web:2.0.0@${RETAGGED}`,
        false,
      ),
    ).not.toThrow();
    expect(() => assertFastLaneDigest(undefined, undefined, false)).not.toThrow();
  });

  test('does nothing when the caller named the image itself (rollback, refresh)', () => {
    expect(() =>
      assertFastLaneDigest(fastLaned(), `registry/acme/web:2.0.0@${RETAGGED}`, true),
    ).not.toThrow();
    expect(mocks.insertAudit).not.toHaveBeenCalled();
  });
});
