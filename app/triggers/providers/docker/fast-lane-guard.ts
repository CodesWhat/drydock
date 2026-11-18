import type { Container } from '../../../model/container.js';
import { fullName } from '../../../model/container.js';
import { isImmutableDigest } from '../../../security/digest.js';
import * as auditStore from '../../../store/audit.js';

/**
 * Raised when an update admitted through the security fast lane would install a different
 * image than the one that qualified. The install is aborted before anything is recreated.
 */
export class FastLaneDigestMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FastLaneDigestMismatchError';
  }
}

type FastLaneGuardContainer = Pick<Container, 'name' | 'image' | 'result' | 'securityFastLane'> &
  Partial<Pick<Container, 'watcher' | 'agent'>>;

function pulledDigestOf(imageIdentity: string | undefined): string | undefined {
  const separatorIndex = imageIdentity?.lastIndexOf('@') ?? -1;
  return separatorIndex >= 0 ? imageIdentity?.slice(separatorIndex + 1) : undefined;
}

/**
 * The fast lane qualified one candidate digest, but the update pulls by tag. After the pull,
 * require that the digest that actually arrived is the one that qualified. A retag in between
 * (or a pull that cannot be tied to a digest at all) aborts this install and is audited; the
 * next watch cycle finds the new candidate and sends it through the normal holds.
 *
 * Only containers carrying the fast lane flag are checked, and only on the update path:
 * a caller that names the image itself (a rollback, a refresh) is deploying what it chose.
 */
export function assertFastLaneDigest(
  container: FastLaneGuardContainer | undefined,
  imageIdentity: string | undefined,
  callerNamedImage: boolean,
): void {
  if (!container?.securityFastLane || callerNamedImage) {
    return;
  }
  const qualified = container.result?.digest;
  const indexDigest = container.result?.indexDigest;
  const pulled = pulledDigestOf(imageIdentity);
  // A pull by tag records the manifest list's digest locally when the image is multi-arch, and
  // the platform manifest's when it is not. Either is the content that qualified; anything
  // else, including a digest this candidate never had, is a retag.
  if (
    pulled !== undefined &&
    (pulled === qualified || (isImmutableDigest(indexDigest) && pulled === indexDigest))
  ) {
    return;
  }
  const detail = pulled
    ? `pulled digest ${pulled} does not match the qualifying candidate ${qualified}`
    : `the pulled digest could not be determined to compare with the qualifying candidate ${qualified}`;
  auditStore.insertAudit({
    id: '',
    timestamp: new Date().toISOString(),
    action: 'security-fast-lane',
    containerName: fullName(container as Container),
    containerImage: container.image?.name,
    status: 'error',
    details: `Security fast lane digest mismatch: ${detail}; install aborted`,
  });
  throw new FastLaneDigestMismatchError(
    `Security fast lane: ${detail}. The update was not installed and will be re-evaluated on the next scan.`,
  );
}
