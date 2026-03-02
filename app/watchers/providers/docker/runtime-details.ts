import type { ContainerRuntimeDetails } from '../../../model/container.js';

function getEmptyRuntimeDetails(): ContainerRuntimeDetails {
  return {
    ports: [],
    volumes: [],
    env: [],
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeRuntimeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.filter(isNonEmptyString).map((value) => value.trim()))];
}

function normalizeRuntimeEnvList(values: unknown): ContainerRuntimeDetails['env'] {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set<string>();
  const envList: ContainerRuntimeDetails['env'] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const key = isNonEmptyString((value as any).key) ? (value as any).key.trim() : '';
    if (key === '') {
      continue;
    }
    const rawEnvValue = (value as any).value;
    const envValue = typeof rawEnvValue === 'string' ? rawEnvValue : `${rawEnvValue ?? ''}`;
    const dedupeKey = `${key}\u0000${envValue}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    envList.push({ key, value: envValue });
  }
  return envList;
}

export function normalizeRuntimeDetails(details: unknown): ContainerRuntimeDetails {
  if (!details || typeof details !== 'object') {
    return getEmptyRuntimeDetails();
  }
  return {
    ports: normalizeRuntimeStringList((details as any).ports),
    volumes: normalizeRuntimeStringList((details as any).volumes),
    env: normalizeRuntimeEnvList((details as any).env),
  };
}

export function areRuntimeDetailsEqual(
  detailsA: ContainerRuntimeDetails | undefined,
  detailsB: ContainerRuntimeDetails | undefined,
) {
  return (
    JSON.stringify(normalizeRuntimeDetails(detailsA)) ===
    JSON.stringify(normalizeRuntimeDetails(detailsB))
  );
}

function formatContainerPortsFromInspect(networkPorts: unknown): string[] {
  if (!networkPorts || typeof networkPorts !== 'object') {
    return [];
  }
  const formattedPorts: string[] = [];
  for (const [containerPort, bindings] of Object.entries(networkPorts as Record<string, unknown>)) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      formattedPorts.push(containerPort);
      continue;
    }
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object') {
        continue;
      }
      const hostIp = typeof (binding as any).HostIp === 'string' ? (binding as any).HostIp : '';
      const hostPort =
        (binding as any).HostPort !== undefined && (binding as any).HostPort !== null
          ? `${(binding as any).HostPort}`
          : '';
      if (hostPort === '') {
        formattedPorts.push(containerPort);
        continue;
      }
      const hostBinding = hostIp !== '' ? `${hostIp}:${hostPort}` : hostPort;
      formattedPorts.push(`${hostBinding}->${containerPort}`);
    }
  }
  return normalizeRuntimeStringList(formattedPorts);
}

function formatContainerPortsFromSummary(containerPorts: unknown): string[] {
  if (!Array.isArray(containerPorts)) {
    return [];
  }
  const formattedPorts: string[] = [];
  for (const port of containerPorts) {
    if (!port || typeof port !== 'object') {
      continue;
    }
    const privatePort = (port as any).PrivatePort;
    if (privatePort === undefined || privatePort === null) {
      continue;
    }
    const protocol = isNonEmptyString((port as any).Type) ? (port as any).Type : 'tcp';
    const containerPort = `${privatePort}/${protocol}`;
    const publicPort = (port as any).PublicPort;
    if (publicPort === undefined || publicPort === null) {
      formattedPorts.push(containerPort);
      continue;
    }
    const hostIp = isNonEmptyString((port as any).IP) ? `${(port as any).IP}:` : '';
    formattedPorts.push(`${hostIp}${publicPort}->${containerPort}`);
  }
  return normalizeRuntimeStringList(formattedPorts);
}

function formatContainerVolumes(mounts: unknown): string[] {
  if (!Array.isArray(mounts)) {
    return [];
  }
  const formattedVolumes: string[] = [];
  for (const mount of mounts) {
    if (!mount || typeof mount !== 'object') {
      continue;
    }
    const source = isNonEmptyString((mount as any).Name)
      ? (mount as any).Name.trim()
      : isNonEmptyString((mount as any).Source)
        ? (mount as any).Source.trim()
        : '';
    const destination = isNonEmptyString((mount as any).Destination)
      ? (mount as any).Destination.trim()
      : '';
    if (source === '' && destination === '') {
      continue;
    }
    let volume =
      source !== '' && destination !== '' ? `${source}:${destination}` : source || destination;
    if ((mount as any).RW === false) {
      volume = `${volume}:ro`;
    }
    formattedVolumes.push(volume);
  }
  return normalizeRuntimeStringList(formattedVolumes);
}

function formatContainerEnv(envVars: unknown): ContainerRuntimeDetails['env'] {
  if (!Array.isArray(envVars)) {
    return [];
  }
  const parsedEnv: ContainerRuntimeDetails['env'] = [];
  for (const envEntry of envVars) {
    if (!isNonEmptyString(envEntry)) {
      continue;
    }
    const separatorIndex = envEntry.indexOf('=');
    const key = separatorIndex >= 0 ? envEntry.slice(0, separatorIndex).trim() : envEntry.trim();
    const value = separatorIndex >= 0 ? envEntry.slice(separatorIndex + 1) : '';
    if (key === '') {
      continue;
    }
    parsedEnv.push({ key, value });
  }
  return normalizeRuntimeEnvList(parsedEnv);
}

export function getRuntimeDetailsFromInspect(containerInspect: any): ContainerRuntimeDetails {
  return {
    ports: formatContainerPortsFromInspect(containerInspect?.NetworkSettings?.Ports),
    volumes: formatContainerVolumes(containerInspect?.Mounts),
    env: formatContainerEnv(containerInspect?.Config?.Env),
  };
}

export function getRuntimeDetailsFromContainerSummary(container: any): ContainerRuntimeDetails {
  return {
    ports: formatContainerPortsFromSummary(container?.Ports),
    volumes: formatContainerVolumes(container?.Mounts),
    env: [],
  };
}

export function mergeRuntimeDetails(
  preferredDetails: ContainerRuntimeDetails,
  fallbackDetails: ContainerRuntimeDetails,
): ContainerRuntimeDetails {
  return {
    ports: preferredDetails.ports.length > 0 ? preferredDetails.ports : fallbackDetails.ports,
    volumes:
      preferredDetails.volumes.length > 0 ? preferredDetails.volumes : fallbackDetails.volumes,
    env: preferredDetails.env.length > 0 ? preferredDetails.env : fallbackDetails.env,
  };
}
