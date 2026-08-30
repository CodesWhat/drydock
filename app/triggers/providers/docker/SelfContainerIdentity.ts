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

export async function resolveSelfContainerIdentity(
  dockerApi: DockerIdentityApi | undefined,
  hostname = process.env.HOSTNAME,
): Promise<SelfContainerIdentity | null> {
  const runtimeHostname = hostname?.trim();
  if (!dockerApi || !runtimeHostname || !HOSTNAME_PATTERN.test(runtimeHostname)) {
    return null;
  }

  let summaries: DockerContainerSummary[];
  try {
    summaries = await dockerApi.listContainers({ all: true });
  } catch {
    return null;
  }

  if (DOCKER_ID_PATTERN.test(runtimeHostname)) {
    const idMatches = summaries.filter(
      (summary): summary is DockerContainerSummary & { Id: string } =>
        typeof summary.Id === 'string' && summary.Id.startsWith(runtimeHostname),
    );
    return idMatches.length === 1 ? getSummaryIdentity(idMatches[0]) : null;
  }

  const inspected = await Promise.allSettled(
    summaries.flatMap((summary) =>
      typeof summary.Id === 'string' && summary.Id.trim()
        ? [Promise.resolve().then(() => dockerApi.getContainer(summary.Id as string).inspect())]
        : [],
    ),
  );
  const hostnameMatches = inspected.flatMap((result) => {
    if (result.status !== 'fulfilled' || result.value.Config?.Hostname !== runtimeHostname) {
      return [];
    }
    const id = typeof result.value.Id === 'string' ? result.value.Id.trim() : '';
    const name = normalizeName(result.value.Name);
    return id && name ? [{ id, name }] : [];
  });

  return hostnameMatches.length === 1 ? hostnameMatches[0] : null;
}
