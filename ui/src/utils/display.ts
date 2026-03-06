/** Pure display helper functions for container/server/registry badge styling. */

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

export function registryLabel(reg: string, registryUrl?: string, registryName?: string) {
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
  return 'Custom';
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
  return { bg: 'transparent', text: 'transparent' };
}

export function bouncerColor(status: string) {
  if (status === 'safe') return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' };
  if (status === 'unsafe') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
}
