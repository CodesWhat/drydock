/** Shared update-kind label resolution for container update badges (major/minor/patch/digest). */
import type { Container } from '../types/container';
import type { TranslateFn } from '../types/i18n';

/**
 * Localized label keys for the known update kinds, under containerComponents.listContent.
 *
 * Container['updateKind'] is a 4-member union by TS type, but raw API payloads aren't
 * type-checked at runtime — a malformed/future kind falls through to a visible neutral
 * "Unknown" badge instead of silently rendering an invisible one (display-honesty item 6;
 * see updateKindColor()'s matching fallback in utils/display.ts).
 */
export const UPDATE_KIND_LABEL_KEYS: Record<'major' | 'minor' | 'patch' | 'digest', string> = {
  major: 'containerComponents.listContent.major',
  minor: 'containerComponents.listContent.minor',
  patch: 'containerComponents.listContent.patch',
  digest: 'containerComponents.listContent.digest',
};

const UPDATE_KIND_FALLBACK_LABELS: Record<'major' | 'minor' | 'patch' | 'digest', string> = {
  major: 'Major',
  minor: 'Minor',
  patch: 'Patch',
  digest: 'Image update',
};

/** True when `kind` is present but isn't one of the known update-kind keys above. */
export function hasUnresolvedUpdateKind(kind: Container['updateKind']): boolean {
  return !!kind && !(kind in UPDATE_KIND_LABEL_KEYS);
}

/**
 * Resolve the localized label for a container/update-insight update kind. Unknown-but-present
 * kinds resolve to a neutral "Unknown" label (localized when `t` is given) instead of rendering
 * nothing, matching updateKindColor()'s neutral-badge fallback. Falls back to plain English text
 * when no translate function is supplied, mirroring the `t?: TranslateFn` idiom used elsewhere in
 * this module family (see update-maturity.ts's formatUpdateAge()).
 */
export function getUpdateKindLabel(kind: Container['updateKind'], t?: TranslateFn): string {
  if (!kind) return '';
  if (hasUnresolvedUpdateKind(kind)) {
    return t ? t('containerComponents.groupedViews.unknownKindLabel') : 'Unknown';
  }
  const knownKind = kind as keyof typeof UPDATE_KIND_LABEL_KEYS;
  return t ? t(UPDATE_KIND_LABEL_KEYS[knownKind]) : UPDATE_KIND_FALLBACK_LABELS[knownKind];
}
