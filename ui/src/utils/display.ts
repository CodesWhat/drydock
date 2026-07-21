/** Pure display helper functions for container/server/registry badge styling. */

/**
 * Internal group-bucket sentinels that must never appear in user-facing text.
 * Any raw group key that matches one of these (or is null/undefined/blank) is
 * treated as "no group" by returning `undefined`, so callers fall through to
 * their no-group locale branch.
 */
const GROUP_SENTINELS = new Set(['__ungrouped__', '__flat__']);

/**
 * Normalise a raw group key or name for display.
 *
 * Returns `undefined` when the value is a sentinel (`__ungrouped__`,
 * `__flat__`), null, undefined, or blank/whitespace-only so callers can
 * use a simple truthiness check and fall through to no-group text.
 */
export function displayGroupName(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (GROUP_SENTINELS.has(trimmed)) return undefined;
  return trimmed;
}

export function parseServer(server: string): { name: string; env: string | null } {
  const m = server.match(/^(.+?)\s*\((.+)\)$/);
  return m ? { name: m[1], env: m[2] } : { name: server, env: null };
}

export function serverBadgeColor(server: string) {
  const { env } = parseServer(server);
  if (!env) return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
  if (env.includes('prod')) return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' };
  if (env.includes('staging')) return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
}

function parseRegistryHost(registryUrl?: string): string | undefined {
  if (typeof registryUrl !== 'string') {
    return undefined;
  }
  const trimmed = registryUrl.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return new URL(trimmed).host;
  } catch {
    const normalized = trimmed.replace(/^[a-z]+:\/\//i, '');
    const host = normalized.split('/')[0];
    return host.length > 0 ? host : undefined;
  }
}

export function registryLabel(
  reg: string,
  registryUrl?: string,
  registryName?: string,
  t?: (key: string) => string,
) {
  if (reg === 'dockerhub') return 'Dockerhub';
  if (reg === 'ghcr') return 'GHCR';
  const host = parseRegistryHost(registryUrl);
  if (host) return host;
  if (typeof registryName === 'string') {
    const trimmed = registryName.trim();
    if (trimmed.length > 0 && trimmed.toLowerCase() !== 'custom') {
      return trimmed;
    }
  }
  return t ? t('common.display.custom') : 'Custom';
}

export function registryColorBg(reg: string) {
  if (reg === 'dockerhub') return 'var(--dd-info-muted)';
  if (reg === 'ghcr') return 'var(--dd-alt-muted)';
  return 'var(--dd-neutral-muted)';
}

export function registryColorText(reg: string) {
  if (reg === 'dockerhub') return 'var(--dd-info)';
  if (reg === 'ghcr') return 'var(--dd-alt)';
  return 'var(--dd-neutral)';
}

export function updateKindColor(kind: string | null) {
  if (kind === 'major') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  if (kind === 'minor') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  if (kind === 'patch') return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)' };
  if (kind === 'digest') return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
  if (kind == null) return { bg: 'transparent', text: 'transparent' };
  // Unrecognized-but-present kind (malformed/future backend data): a visible
  // neutral badge beats a silently invisible one (#display-honesty item 6).
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
}

export function maturityColor(maturity: string | null) {
  if (maturity === 'fresh') {
    return {
      bg: 'color-mix(in srgb, var(--dd-warning) 35%, var(--dd-bg-card))',
      text: 'var(--dd-text)',
    };
  }
  if (maturity === 'settled') {
    return {
      bg: 'color-mix(in srgb, var(--dd-info) 35%, var(--dd-bg-card))',
      text: 'var(--dd-text)',
    };
  }
  return { bg: 'transparent', text: 'transparent' };
}

export function suggestedTagColor() {
  return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)' };
}

/**
 * Color for the pin-gate informational insight badge (#498). Uses the `info`
 * token, which none of the four `updateKindColor()` kinds use (major=danger,
 * minor=warning, patch=primary, digest=neutral) — this badge must never
 * share a color with any of them, since an insight badge and an actionable
 * update-kind badge can legitimately render side by side on the same row.
 */
export function updateInsightColor() {
  return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
}
