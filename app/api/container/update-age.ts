import type { Container } from '../../model/container.js';

export function getContainerUpdateAge(container: Container): number | undefined {
  const age = container.updateAge;
  if (typeof age === 'number' && Number.isFinite(age)) {
    return age;
  }

  // Match the model layer's own gate (model/container.ts getRawUpdateAge):
  // no available update means no age to report, full stop. A falsy check
  // (not `=== false`) is deliberate — `updateAvailable` left unset (never
  // evaluated) and `updateAvailable: false` (evaluated and gated, e.g. by
  // maturityMode) both mean "nothing to age" here, same as upstream.
  if (!container.updateAvailable) {
    return undefined;
  }

  // Fallback for containers not processed through validate() — includes
  // updateDetectedAt as a third date source that the model layer omits.
  const firstSeenAtMs = Date.parse(container.firstSeenAt || '');
  const publishedAtMs = Date.parse(container.result?.publishedAt || '');
  const updateDetectedAtMs = Date.parse(container.updateDetectedAt || '');
  let startedAtMs: number | undefined;
  if (Number.isFinite(firstSeenAtMs) && Number.isFinite(publishedAtMs)) {
    startedAtMs = Math.min(firstSeenAtMs, publishedAtMs);
  } else if (Number.isFinite(firstSeenAtMs)) {
    startedAtMs = firstSeenAtMs;
  } else if (Number.isFinite(publishedAtMs)) {
    startedAtMs = publishedAtMs;
  } else if (Number.isFinite(updateDetectedAtMs)) {
    startedAtMs = updateDetectedAtMs;
  }

  return startedAtMs === undefined ? undefined : Math.max(0, Date.now() - startedAtMs);
}
