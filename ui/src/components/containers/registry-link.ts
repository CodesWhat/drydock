import { ROUTES } from '../../router/routes';
import type { Container } from '../../types/container';

type RegistryKind = Container['registry'];

function trimmedValue(value?: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function registryHost(registryUrl?: string): string {
  const value = trimmedValue(registryUrl);
  if (!value) return '';

  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(normalized).hostname;
  } catch {
    return '';
  }
}

export function registryLookup(
  registry?: RegistryKind,
  registryName?: string,
  registryUrl?: string,
): string {
  const name = trimmedValue(registryName);
  if (name && name.toLowerCase() !== 'custom') return name;
  if (registry === 'dockerhub') return 'hub';
  if (registry === 'ghcr') return 'ghcr';
  return registryHost(registryUrl);
}

export function registryHref(lookup: string): string {
  const query = new URLSearchParams({ q: lookup });
  return `${ROUTES.REGISTRIES}?${query.toString()}`;
}
