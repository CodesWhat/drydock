import type { Container } from './container.js';

/** The labels that name a container's group, highest priority first. */
const GROUP_LABELS = [
  'dd.group',
  'com.docker.compose.project',
  'com.docker.stack.namespace',
] as const;

export interface ContainerGroupIdentity {
  /** The exact label value: no trimming, no case folding. */
  name: string;
  /** The label that supplied it. */
  label: (typeof GROUP_LABELS)[number];
}

/**
 * The group a container belongs to and the label that named it, or null. `??` means an
 * empty higher-priority label does not fall through to a lower one.
 */
export function getContainerGroupIdentity(
  container: Pick<Container, 'labels'>,
): ContainerGroupIdentity | null {
  for (const label of GROUP_LABELS) {
    const name = container.labels?.[label];
    if (typeof name === 'string') {
      return { name, label };
    }
  }
  return null;
}

export function getContainerGroup(container: Pick<Container, 'labels'>): string | null {
  return getContainerGroupIdentity(container)?.name ?? null;
}
