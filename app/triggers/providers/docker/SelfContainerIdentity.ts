import { hostname as getRuntimeHostname } from 'node:os';

const DOCKER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;
const HOSTNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export interface SelfContainerIdentity {
  id: string;
  name: string;
}

interface DockerContainerSummary {
  Id?: string;
  Names?: string[];
}

interface DockerContainerInspect {
  Id?: string;
  Name?: string;
  Config?: {
    Hostname?: string;
  };
  HostConfig?: {
    UTSMode?: string;
  };
}

interface DockerIdentityApi {
  listContainers: (options?: { all?: boolean }) => Promise<DockerContainerSummary[]>;
  getContainer: (id: string) => {
    inspect: () => Promise<DockerContainerInspect>;
  };
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^\/+/, '') : '';
}

function getSummaryIdentity(
  summary: DockerContainerSummary & { Id: string },
): SelfContainerIdentity | null {
  const id = summary.Id.trim();
  const name = normalizeName(summary.Names?.[0]);
  return id && name ? { id, name } : null;
}

export type SelfContainerProbe =
  | { status: 'found'; identity: SelfContainerIdentity }
  | { status: 'absent' }
  | { status: 'unknown' };

const UNKNOWN_PROBE: SelfContainerProbe = { status: 'unknown' };

export async function resolveSelfContainerIdentity(
  dockerApi: DockerIdentityApi | undefined,
  hostname = getRuntimeHostname(),
): Promise<SelfContainerIdentity | null> {
  const probe = await probeSelfContainerIdentity(dockerApi, hostname, true);
  return probe.status === 'found' ? probe.identity : null;
}

/**
 * Tri-state variant of resolveSelfContainerIdentity: `absent` means the daemon
 * was listed and inspected cleanly and none of its containers is this process,
 * which is the only evidence that proves a watcher's daemon is a peer.
 */
export async function probeSelfContainerIdentity(
  dockerApi: DockerIdentityApi | undefined,
  hostname = getRuntimeHostname(),
  trustHostnameMatch = false,
): Promise<SelfContainerProbe> {
  const runtimeHostname = hostname?.trim();
  if (!dockerApi || !runtimeHostname || !HOSTNAME_PATTERN.test(runtimeHostname)) {
    return UNKNOWN_PROBE;
  }

  let summaries: DockerContainerSummary[];
  try {
    summaries = await dockerApi.listContainers({ all: true });
  } catch {
    return UNKNOWN_PROBE;
  }
  if (
    !Array.isArray(summaries) ||
    summaries.some((summary) => typeof summary.Id !== 'string' || !summary.Id.trim())
  ) {
    return UNKNOWN_PROBE;
  }

  if (DOCKER_ID_PATTERN.test(runtimeHostname)) {
    const idMatches = summaries.filter(
      (summary): summary is DockerContainerSummary & { Id: string } =>
        typeof summary.Id === 'string' && summary.Id.startsWith(runtimeHostname),
    );
    if (idMatches.length === 1) {
      const identity = getSummaryIdentity(idMatches[0]);
      return identity ? { status: 'found', identity } : UNKNOWN_PROBE;
    }
    if (idMatches.length > 1) {
      return UNKNOWN_PROBE;
    }
    // No ID prefix match: a recreated container can carry its predecessor's
    // ID as a stale hostname, so fall through to the inspected hostname match.
  }

  const inspected = await Promise.allSettled(
    summaries.map((summary) =>
      Promise.resolve().then(() => dockerApi.getContainer(summary.Id as string).inspect()),
    ),
  );
  if (inspected.some((result) => result.status !== 'fulfilled')) {
    return UNKNOWN_PROBE;
  }
  const inspectedIdentities = inspected.map((result) => {
    const value = (result as PromiseFulfilledResult<DockerContainerInspect>).value;
    const id = typeof value.Id === 'string' ? value.Id.trim() : '';
    const name = normalizeName(value.Name);
    const inspectedHostname = value.Config?.Hostname;
    return id && name && typeof inspectedHostname === 'string' && inspectedHostname.trim()
      ? { id, name, hostname: inspectedHostname, utsMode: value.HostConfig?.UTSMode }
      : null;
  });
  if (inspectedIdentities.some((identity) => !identity)) {
    return UNKNOWN_PROBE;
  }
  const hostnameMatches = inspectedIdentities.filter(
    (identity) => identity?.hostname === runtimeHostname,
  );

  if (hostnameMatches.length === 0) {
    // Host UTS containers observe a mutable host hostname, so Config.Hostname
    // cannot prove this process is absent from their daemon.
    return inspectedIdentities.some((identity) => identity!.utsMode === 'host')
      ? UNKNOWN_PROBE
      : { status: 'absent' };
  }
  return hostnameMatches.length === 1 && trustHostnameMatch
    ? { status: 'found', identity: { id: hostnameMatches[0]!.id, name: hostnameMatches[0]!.name } }
    : UNKNOWN_PROBE;
}
