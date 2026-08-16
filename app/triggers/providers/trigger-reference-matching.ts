import type { Container } from '../../model/container.js';
import { isThresholdReached, SUPPORTED_THRESHOLDS } from './trigger-threshold.js';

type SupportedThreshold = (typeof SUPPORTED_THRESHOLDS)[number];

/**
 * `dd.action.include` / `dd.action.exclude` / `dd.action.auto` (and their
 * notification-category counterparts) all share one grammar: a comma-
 * separated list of trigger references, each an optional `name:threshold`
 * pair. This module owns that grammar as a leaf (no dependency beyond the
 * `Container` type and the threshold helper), so it can be imported from
 * anywhere without the require-cycle risk documented in
 * `triggers/trigger-category.ts` — most notably from
 * `model/action-policy.ts`, which cannot import `Trigger.ts` as a value
 * (`Trigger.ts` -> `updates/request-update.ts` -> `model/update-eligibility.ts`
 * -> `model/action-policy.ts` would close the cycle).
 *
 * `Trigger.ts`'s static `parseIncludeOrIncludeTriggerString` /
 * `doesReferenceMatchId` and its instance `isTriggerIncludedOrExcluded`
 * delegate here rather than duplicating the grammar.
 */
export interface ParsedTriggerReference {
  id: string;
  threshold: SupportedThreshold;
}

function isSupportedThreshold(value: string): value is SupportedThreshold {
  return SUPPORTED_THRESHOLDS.includes(value as SupportedThreshold);
}

export function splitAndTrimCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse a single `$name` or `$name:$threshold` reference string.
 */
export function parseIncludeOrIncludeTriggerString(
  includeOrExcludeTriggerString: string,
): ParsedTriggerReference {
  const hasThresholdSeparator = includeOrExcludeTriggerString.includes(':');
  const separatorIndex = hasThresholdSeparator ? includeOrExcludeTriggerString.indexOf(':') : -1;
  const hasMultipleSeparators =
    hasThresholdSeparator && includeOrExcludeTriggerString.slice(separatorIndex + 1).includes(':');

  const triggerId = hasThresholdSeparator
    ? includeOrExcludeTriggerString.slice(0, separatorIndex).trim()
    : includeOrExcludeTriggerString.trim();
  const includeOrExcludeTrigger: ParsedTriggerReference = {
    id: triggerId,
    threshold: 'all',
  };

  if (hasThresholdSeparator && !hasMultipleSeparators) {
    const thresholdCandidate = includeOrExcludeTriggerString
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase();
    if (isSupportedThreshold(thresholdCandidate)) {
      includeOrExcludeTrigger.threshold = thresholdCandidate;
    }
  }

  return includeOrExcludeTrigger;
}

/**
 * Return true when a trigger reference matches a trigger id.
 * A reference can be either:
 * - full trigger id: docker.update
 * - trigger name only: update
 */
export function doesReferenceMatchId(triggerReference: string, triggerId: string): boolean {
  const triggerReferenceNormalized = triggerReference.toLowerCase();
  const triggerIdNormalized = triggerId.toLowerCase();

  if (triggerReferenceNormalized === triggerIdNormalized) {
    return true;
  }

  const triggerIdParts = triggerIdNormalized.split('.');
  const triggerName = triggerIdParts.at(-1);
  if (!triggerName) {
    return false;
  }
  if (triggerReferenceNormalized === triggerName) {
    return true;
  }

  if (triggerIdParts.length >= 2) {
    const provider = triggerIdParts.at(-2);
    const providerAndName = `${provider}.${triggerName}`;
    if (triggerReferenceNormalized === providerAndName) {
      return true;
    }
  }

  return false;
}

/**
 * Return true when `triggerId` is referenced in `referenceList` (a comma
 * separated `dd.action.include` / `dd.action.exclude` / `dd.action.auto`
 * style label value) AND the container's update meets that reference's
 * threshold. Mirrors `Trigger.isTriggerIncludedOrExcluded`, generalized to
 * take the trigger id directly instead of reading it off `this`.
 */
export function matchesTriggerReferenceList(
  triggerId: string,
  referenceList: string | undefined,
  containerResult: Container,
): boolean {
  if (!referenceList) {
    return false;
  }
  const normalizedTriggerId = triggerId.toLowerCase();
  const references = splitAndTrimCommaSeparatedList(referenceList).map((reference) =>
    parseIncludeOrIncludeTriggerString(reference),
  );
  const matched = references.find((reference) =>
    doesReferenceMatchId(reference.id, normalizedTriggerId),
  );
  if (!matched) {
    return false;
  }
  return isThresholdReached(containerResult, matched.threshold.toLowerCase());
}
