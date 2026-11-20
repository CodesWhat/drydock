/**
 * Threshold-aware candidate selection (opt-in via the trigger option
 * `separateupdatetypes`). When a trigger's threshold rules out the primary
 * update (for example the primary is a major and the threshold is `minor`),
 * the auto path offers the best candidate within the threshold instead of
 * doing nothing. The chosen candidate becomes the container's result, so the
 * notification, the approval item and the update itself all name its tag.
 */

import type { UpdateCandidate, UpdateCandidateType } from '../tag/update-candidates.js';
import { isThresholdReached } from '../triggers/providers/trigger-threshold.js';
import type { Container } from './container.js';
import { isTagSkipped } from './skip-scope.js';

/** Highest change first: the best candidate inside the threshold is the largest one. */
const PREFERENCE: readonly UpdateCandidateType[] = ['major', 'minor', 'patch'];

export interface SeparateUpdateTypesTrigger {
  configuration?: { separateupdatetypes?: boolean; threshold?: string };
}

/** Whether the trigger opted in. Absent or false keeps the primary-only behavior. */
export function isSeparateUpdateTypesEnabled(
  trigger: SeparateUpdateTypesTrigger | undefined,
): boolean {
  return trigger?.configuration?.separateupdatetypes === true;
}

/** The container with `candidate` as its result and update kind; the original is untouched. */
function withCandidate(container: Container, candidate: UpdateCandidate): Container {
  return {
    ...container,
    result: {
      tag: candidate.tag,
      ...(candidate.digest === undefined ? {} : { digest: candidate.digest }),
      updateCandidates: container.result?.updateCandidates,
    },
    updateKind: {
      kind: 'tag',
      localValue: container.image.tag.value,
      remoteValue: candidate.tag,
      semverDiff: candidate.semverDiff,
    },
    updateAvailable: true,
  };
}

/**
 * Return the container the trigger should act on: the container itself when its
 * primary reaches the threshold (or nothing better exists), otherwise a copy
 * carrying the best candidate that does. Only containers with an available tag
 * update are considered, so snoozed, digest-only and non-semver containers are
 * left exactly as they were.
 */
export function selectCandidateWithinThreshold(container: Container, threshold: string): Container {
  const candidates = container.result?.updateCandidates;
  if (
    !candidates ||
    !container.updateAvailable ||
    container.updateKind?.kind !== 'tag' ||
    isThresholdReached(container, threshold)
  ) {
    return container;
  }
  const skipTags = container.updatePolicy?.skipTags;
  for (const type of PREFERENCE) {
    const candidate = candidates[type];
    if (!candidate || isTagSkipped(candidate.tag, skipTags, container.transformTags)) {
      continue;
    }
    const selected = withCandidate(container, candidate);
    if (isThresholdReached(selected, threshold)) {
      return selected;
    }
  }
  return container;
}

/** `selectCandidateWithinThreshold` for a trigger that opted in; a no-op otherwise. */
export function applySeparateUpdateTypes(
  container: Container,
  trigger: SeparateUpdateTypesTrigger | undefined,
): Container {
  if (!isSeparateUpdateTypesEnabled(trigger)) {
    return container;
  }
  return selectCandidateWithinThreshold(
    container,
    (trigger?.configuration?.threshold ?? 'all').toLowerCase(),
  );
}
