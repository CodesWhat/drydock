import type { ContainerRuntimeDetails } from '../../../model/container.js';

type UnknownRecord = Record<string, unknown>;

function getEmptyRuntimeDetails(): ContainerRuntimeDetails {
  return {
    ports: [],
    volumes: [],
    env: [],
  };
}

function asUnknownRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
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
    const envValueCandidate = asUnknownRecord(value);
    if (!envValueCandidate) {
      continue;
    }
    const key = isNonEmptyString(envValueCandidate.key) ? envValueCandidate.key.trim() : '';
    if (key === '') {
      continue;
    }
    const rawEnvValue = envValueCandidate.value;
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
  const runtimeDetails = asUnknownRecord(details);
  if (!runtimeDetails) {
    return getEmptyRuntimeDetails();
  }
  return {
    ports: normalizeRuntimeStringList(runtimeDetails.ports),
    volumes: normalizeRuntimeStringList(runtimeDetails.volumes),
    env: normalizeRuntimeEnvList(runtimeDetails.env),
  };
}

export function areRuntimeDetailsEqual(
  detailsA: ContainerRuntimeDetails | undefined,
  detailsB: ContainerRuntimeDetails | undefined,
) {
  const normalizedDetailsA = normalizeRuntimeDetails(detailsA);
  const normalizedDetailsB = normalizeRuntimeDetails(detailsB);

  if (normalizedDetailsA.ports.length !== normalizedDetailsB.ports.length) {
    return false;
  }
  if (normalizedDetailsA.volumes.length !== normalizedDetailsB.volumes.length) {
    return false;
  }
  if (normalizedDetailsA.env.length !== normalizedDetailsB.env.length) {
    return false;
  }

  for (let index = 0; index < normalizedDetailsA.ports.length; index += 1) {
    if (normalizedDetailsA.ports[index] !== normalizedDetailsB.ports[index]) {
      return false;
    }
  }

  for (let index = 0; index < normalizedDetailsA.volumes.length; index += 1) {
    if (normalizedDetailsA.volumes[index] !== normalizedDetailsB.volumes[index]) {
      return false;
    }
  }

  for (let index = 0; index < normalizedDetailsA.env.length; index += 1) {
    if (
      normalizedDetailsA.env[index].key !== normalizedDetailsB.env[index].key ||
      normalizedDetailsA.env[index].value !== normalizedDetailsB.env[index].value
    ) {
      return false;
    }
  }

  return true;
}

function formatContainerPortsFromInspect(networkPorts: unknown): string[] {
  if (!networkPorts || typeof networkPorts !== 'object') {
    return [];
  }
  const formattedPorts = Object.entries(networkPorts as Record<string, unknown>).flatMap(
    ([containerPort, bindings]) => formatInspectContainerPortBindings(containerPort, bindings),
  );
  return normalizeRuntimeStringList(formattedPorts);
}

function formatInspectContainerPortBindings(containerPort: string, bindings: unknown): string[] {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return [containerPort];
  }
  const formattedPorts: string[] = [];
  for (const binding of bindings) {
    const formattedPort = formatInspectPortBinding(containerPort, binding);
    if (!formattedPort) {
      continue;
    }
    formattedPorts.push(formattedPort);
  }
  return formattedPorts;
}

function formatInspectPortBinding(containerPort: string, binding: unknown): string | null {
  const portBinding = asUnknownRecord(binding);
  if (!portBinding) {
    return null;
  }
  const hostIp = typeof portBinding.HostIp === 'string' ? portBinding.HostIp : '';
  const hostPortRaw = portBinding.HostPort;
  const hostPort = hostPortRaw !== undefined && hostPortRaw !== null ? `${hostPortRaw}` : '';
  if (hostPort === '') {
    return containerPort;
  }
  const hostBinding = hostIp !== '' ? `${hostIp}:${hostPort}` : hostPort;
  return `${hostBinding}->${containerPort}`;
}

function formatContainerPortsFromSummary(containerPorts: unknown): string[] {
  if (!Array.isArray(containerPorts)) {
    return [];
  }
  const formattedPorts: string[] = [];
  for (const port of containerPorts) {
    const summaryPort = asUnknownRecord(port);
    if (!summaryPort) {
      continue;
    }
    const privatePort = summaryPort.PrivatePort;
    if (privatePort === undefined || privatePort === null) {
      continue;
    }
    const protocol = isNonEmptyString(summaryPort.Type) ? summaryPort.Type : 'tcp';
    const containerPort = `${privatePort}/${protocol}`;
    const publicPort = summaryPort.PublicPort;
    if (publicPort === undefined || publicPort === null) {
      formattedPorts.push(containerPort);
      continue;
    }
    const hostIp = isNonEmptyString(summaryPort.IP) ? `${summaryPort.IP}:` : '';
    formattedPorts.push(`${hostIp}${publicPort}->${containerPort}`);
  }
  return normalizeRuntimeStringList(formattedPorts);
}

function formatContainerVolumes(mounts: unknown): string[] {
  if (!Array.isArray(mounts)) {
    return [];
  }
  const formattedVolumes = mounts.flatMap((mount) => {
    const formattedVolume = formatContainerMountVolume(mount);
    return formattedVolume ? [formattedVolume] : [];
  });
  return normalizeRuntimeStringList(formattedVolumes);
}

function formatContainerMountVolume(mount: unknown): string | null {
  const mountDetails = asUnknownRecord(mount);
  if (!mountDetails) {
    return null;
  }
  const source = getContainerMountSource(mountDetails);
  const destination = getContainerMountDestination(mountDetails);
  const baseVolume = formatVolumeBinding(source, destination);
  if (baseVolume === '') {
    return null;
  }
  return mountDetails.RW === false ? `${baseVolume}:ro` : baseVolume;
}

function getContainerMountSource(mount: UnknownRecord): string {
  if (isNonEmptyString(mount.Name)) {
    return mount.Name.trim();
  }
  if (isNonEmptyString(mount.Source)) {
    return mount.Source.trim();
  }
  return '';
}

function getContainerMountDestination(mount: UnknownRecord): string {
  return isNonEmptyString(mount.Destination) ? mount.Destination.trim() : '';
}

function formatVolumeBinding(source: string, destination: string): string {
  if (source === '' && destination === '') {
    return '';
  }
  if (source !== '' && destination !== '') {
    return `${source}:${destination}`;
  }
  return source || destination;
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

export function getRuntimeDetailsFromInspect(containerInspect: unknown): ContainerRuntimeDetails {
  const inspect = asUnknownRecord(containerInspect);
  const networkSettings = asUnknownRecord(inspect?.NetworkSettings);
  const config = asUnknownRecord(inspect?.Config);

  return {
    ports: formatContainerPortsFromInspect(networkSettings?.Ports),
    volumes: formatContainerVolumes(inspect?.Mounts),
    env: formatContainerEnv(config?.Env),
  };
}

export function getRuntimeDetailsFromContainerSummary(container: unknown): ContainerRuntimeDetails {
  const containerSummary = asUnknownRecord(container);
  return {
    ports: formatContainerPortsFromSummary(containerSummary?.Ports),
    volumes: formatContainerVolumes(containerSummary?.Mounts),
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
