export type TagFamilyPolicy = 'strict' | 'loose';

/**
 * Normalize a raw `dd.tag.family` label value to its effective policy.
 * Missing, blank, and invalid values all resolve to the default `strict`;
 * callers that want to warn on invalid input should validate separately
 * (see getTagFamilyPolicy in tag-candidates.ts).
 */
export function normalizeTagFamilyPolicy(rawPolicy: string | undefined): TagFamilyPolicy {
  if (!rawPolicy) {
    return 'strict';
  }
  return rawPolicy.trim().toLowerCase() === 'loose' ? 'loose' : 'strict';
}

interface PinGateContainerLike {
  includeTags?: string;
  tagFamily?: string;
  image: {
    tag: {
      tagPrecision?: 'specific' | 'floating';
    };
  };
}

/**
 * True when the pin gate governs this container: a specific-precision tag with
 * no dd.tag.include filter under a non-loose family policy. Such tags are
 * digest-only by default — drydock never climbs them to newer versions, it only
 * surfaces an informational insight. This is the single source of truth for
 * that condition; the tag-candidates gate and the container model's
 * `tagPinGated` field (which drives the UI pin glyph) both consume it so the
 * rendered pin can never drift from what the gate actually does.
 */
export function isPinGateGoverned(container: PinGateContainerLike): boolean {
  return (
    container.image.tag.tagPrecision === 'specific' &&
    !container.includeTags &&
    normalizeTagFamilyPolicy(container.tagFamily) !== 'loose'
  );
}
