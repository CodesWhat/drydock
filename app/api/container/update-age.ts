import type { Container } from '../../model/container.js';

export function getContainerUpdateAge(container: Container): number | undefined {
  const age = container.updateAge;
  if (typeof age === 'number' && Number.isFinite(age)) {
    return age;
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
