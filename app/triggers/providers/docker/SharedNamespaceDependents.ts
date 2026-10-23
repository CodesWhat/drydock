import { getErrorMessage } from '../../../util/error.js';

/**
 * Containers that borrow another container's namespace or volumes
 * (`network_mode: container:<id>` / `service:<name>`, or `volumes_from`) hold
 * a reference to the owner's container ID. Recreating the owner mints a new
 * ID, so the borrower keeps pointing at the removed container: it loses its
 * network (the namespace died with the owner and a plain restart fails with
 * "joining network namespace of container: No such container") or keeps the
 * old container's volume mounts. The borrower has to be recreated with the
 * reference rewritten to the new owner.
 */

type SharedNamespaceLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type HostConfigLike = {
  NetworkMode?: string;
  VolumesFrom?: string[] | null;
  [key: string]: unknown;
};

export type SharedNamespaceContainerSpec = {
  Id: string;
  Name: string;
  HostConfig?: HostConfigLike;
  [key: string]: unknown;
};

type SharedNamespaceDockerApi = {
  listContainers: (options: { all: boolean }) => Promise<Array<{ Id: string }>>;
  getContainer: (identifier: string) => {
    inspect: () => Promise<SharedNamespaceContainerSpec>;
  };
};

type RecreateDependent = (
  dependentSpec: SharedNamespaceContainerSpec,
  hostConfig: HostConfigLike,
) => Promise<void>;

export type SharedNamespaceRecreateResult = {
  /** One message per borrower that could not be recreated or was skipped. */
  failures: string[];
};

const NETWORK_NAMESPACE_PREFIX = 'container:';
const MIN_ABBREVIATED_ID_LENGTH = 12;

function matchesContainer(
  reference: string,
  spec: { Id: string; Name: string },
): 'id' | 'name' | undefined {
  if (
    reference === spec.Id ||
    (reference.length >= MIN_ABBREVIATED_ID_LENGTH && spec.Id.startsWith(reference))
  ) {
    return 'id';
  }
  return reference === spec.Name.replace(/^\//, '') ? 'name' : undefined;
}

/** Every container reference in a host config: the shared namespace and each volumes_from entry. */
function getBorrowedReferences(hostConfig: HostConfigLike | undefined): string[] {
  const references: string[] = [];
  const networkMode = hostConfig?.NetworkMode;
  if (typeof networkMode === 'string' && networkMode.startsWith(NETWORK_NAMESPACE_PREFIX)) {
    references.push(networkMode.slice(NETWORK_NAMESPACE_PREFIX.length));
  }
  if (Array.isArray(hostConfig?.VolumesFrom)) {
    for (const entry of hostConfig.VolumesFrom) {
      references.push(entry.split(':')[0]);
    }
  }
  return references;
}

/**
 * Rewrite every container reference in a host config through `resolve`, which
 * returns the new id for a reference that points at a replaced container and
 * the kind of match. ID references move to the new id; name references already
 * resolve to the replacement and stay as written. Returns undefined when no
 * reference was touched.
 */
export function buildFollowOwnerHostConfig(
  hostConfig: HostConfigLike | undefined,
  resolve: (reference: string) => { kind: 'id' | 'name'; newId: string } | undefined,
): HostConfigLike | undefined {
  if (!hostConfig) {
    return undefined;
  }
  let borrows = false;
  const rewritten: HostConfigLike = { ...hostConfig };

  const networkMode = hostConfig.NetworkMode;
  if (typeof networkMode === 'string' && networkMode.startsWith(NETWORK_NAMESPACE_PREFIX)) {
    const match = resolve(networkMode.slice(NETWORK_NAMESPACE_PREFIX.length));
    if (match) {
      borrows = true;
      rewritten.NetworkMode = `${NETWORK_NAMESPACE_PREFIX}${match.newId}`;
    }
  }

  if (Array.isArray(hostConfig.VolumesFrom)) {
    rewritten.VolumesFrom = hostConfig.VolumesFrom.map((entry) => {
      const [reference, ...modes] = entry.split(':');
      const match = resolve(reference);
      if (!match) {
        return entry;
      }
      borrows = true;
      return match.kind === 'id' ? [match.newId, ...modes].join(':') : entry;
    });
  }

  return borrows ? rewritten : undefined;
}

/**
 * After an owner container was replaced (same name, new ID), recreate every
 * container that borrows its namespace or volumes, directly or through another
 * borrower, so it follows the new owner. The affected set is computed up front
 * and recreated in dependency order. Every reference a borrower holds (its
 * network and each volumes_from entry) is rewritten through one old-to-new id
 * map before it is created, so a borrower of several recreated containers never
 * gets a stale id. A borrower whose own dependency failed is skipped. Failures
 * are returned and logged, never thrown: the owner's update already succeeded.
 */
export async function recreateSharedNamespaceDependents(options: {
  dockerApi: SharedNamespaceDockerApi;
  previousContainerId: string;
  containerName: string;
  logContainer: SharedNamespaceLogger;
  recreateDependent: RecreateDependent;
}): Promise<SharedNamespaceRecreateResult> {
  const { dockerApi, previousContainerId, containerName, logContainer, recreateDependent } =
    options;
  const failures: string[] = [];
  const fail = (message: string) => {
    failures.push(message);
    logContainer.warn(message);
  };

  let ownerNewId: string;
  const specs = new Map<string, SharedNamespaceContainerSpec>();
  try {
    ownerNewId = (await (await dockerApi.getContainer(containerName)).inspect()).Id;
    for (const { Id } of await dockerApi.listContainers({ all: true })) {
      if (Id === previousContainerId || Id === ownerNewId) {
        continue;
      }
      try {
        specs.set(Id, await (await dockerApi.getContainer(Id)).inspect());
      } catch {
        // Removed between the list and the inspect: it cannot be a borrower any more.
      }
    }
  } catch (error: unknown) {
    fail(
      `Unable to look for containers sharing the namespace of ${containerName} (${getErrorMessage(error)})`,
    );
    return { failures };
  }

  // The container a reference names: the replaced owner, or another listed container.
  const resolveTarget = (reference: string): { key: string; kind: 'id' | 'name' } | undefined => {
    const ownerMatch = matchesContainer(reference, {
      Id: previousContainerId,
      Name: containerName,
    });
    if (ownerMatch) {
      return { key: previousContainerId, kind: ownerMatch };
    }
    for (const spec of specs.values()) {
      const kind = matchesContainer(reference, spec);
      if (kind) {
        return { key: spec.Id, kind };
      }
    }
    return undefined;
  };

  // Which containers borrow from which, then the affected set (fixpoint) in
  // dependency order (Kahn): a borrower is only recreated after what it borrows.
  const borrowsFrom = new Map<string, Set<string>>();
  for (const spec of specs.values()) {
    const targets = new Set<string>();
    for (const reference of getBorrowedReferences(spec.HostConfig)) {
      const target = resolveTarget(reference);
      if (target) {
        targets.add(target.key);
      }
    }
    borrowsFrom.set(spec.Id, targets);
  }
  const affected = new Set<string>([previousContainerId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, targets] of borrowsFrom) {
      if (!affected.has(id) && [...targets].some((target) => affected.has(target))) {
        affected.add(id);
        grew = true;
      }
    }
  }
  affected.delete(previousContainerId);

  const order: string[] = [];
  const done = new Set<string>([previousContainerId]);
  for (let progressed = true; progressed && order.length < affected.size; ) {
    progressed = false;
    for (const id of affected) {
      if (done.has(id)) {
        continue;
      }
      const waitingOn = [...borrowsFrom.get(id)!].filter((target) => affected.has(target));
      if (waitingOn.every((target) => done.has(target))) {
        done.add(id);
        order.push(id);
        progressed = true;
      }
    }
  }

  const newIds = new Map<string, string>([[previousContainerId, ownerNewId]]);
  const failedIds = new Set<string>();
  for (const id of order) {
    const dependentSpec = specs.get(id)!;
    const dependentName = dependentSpec.Name.replace(/^\//, '');
    const dependencyFailed = [...borrowsFrom.get(id)!].find((target) => failedIds.has(target));
    if (dependencyFailed) {
      failedIds.add(id);
      fail(
        `Skipped ${dependentName} because a container it shares a namespace or volumes with could not be recreated`,
      );
      continue;
    }
    // Every affected container borrows from the owner or from a container recreated
    // before it, so at least one reference always resolves.
    const hostConfig = buildFollowOwnerHostConfig(dependentSpec.HostConfig, (reference) => {
      const target = resolveTarget(reference);
      const newId = target && newIds.get(target.key);
      return target && newId ? { kind: target.kind, newId } : undefined;
    })!;
    logContainer.info(
      `Recreate ${dependentName} so it follows the replaced container ${containerName}`,
    );
    try {
      await recreateDependent(dependentSpec, hostConfig);
      newIds.set(id, (await (await dockerApi.getContainer(dependentName)).inspect()).Id);
    } catch (error: unknown) {
      failedIds.add(id);
      fail(`Unable to recreate ${dependentName} (${getErrorMessage(error)})`);
    }
  }
  if (order.length < affected.size) {
    fail('Skipped containers with circular namespace or volume references');
  }
  return { failures };
}
