// Engine API version that added `Identity` to image inspect responses.
const IDENTITY_API_VERSION = '1.53';

interface ImageOriginPayload {
  Identity?: { Pull?: unknown[]; [key: string]: unknown };
  Descriptor?: unknown;
  [key: string]: unknown;
}

interface VersionedDockerApi {
  version?: () => Promise<unknown>;
  modem?: { version?: string };
}

// Only successful lookups are cached, keyed by client so a re-created client
// (watcher re-init) asks again.
const apiVersionCache = new WeakMap<object, string>();

function isApiVersionAtLeast(version: string, minimum: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  const [minMajor, minMinor] = minimum.split('.').map(Number);
  return major > minMajor || (major === minMajor && minor >= minMinor);
}

/**
 * The API version inspect requests are served at. Socket watchers pin docker-modem
 * to the daemon's own version at init (`v1.53`), so that pin is authoritative. An
 * unversioned client (remote host) is served at the daemon's latest, which
 * `GET /version` reports.
 */
export async function getDaemonApiVersion(
  dockerApi: VersionedDockerApi | undefined,
): Promise<string | undefined> {
  if (!dockerApi) {
    return undefined;
  }
  const pinned = dockerApi.modem?.version;
  if (pinned) {
    return pinned.replace(/^v/, '');
  }
  const cached = apiVersionCache.get(dockerApi);
  if (cached) {
    return cached;
  }
  if (typeof dockerApi.version !== 'function') {
    return undefined;
  }
  try {
    const payload = (await dockerApi.version()) as { ApiVersion?: unknown };
    if (typeof payload?.ApiVersion === 'string' && payload.ApiVersion !== '') {
      apiVersionCache.set(dockerApi, payload.ApiVersion);
      return payload.ApiVersion;
    }
  } catch {
    // Best-effort: fall back to the RepoDigests rule.
  }
  return undefined;
}

/**
 * Decide whether an image was built or loaded locally rather than pulled (#1506).
 *
 * The containerd image store reports `name@digest` in RepoDigests for every named
 * image, local or pulled, so RepoDigests alone cannot tell them apart there. On
 * Engine API 1.53+ inspect carries `Identity`: `Pull` lists the registries the
 * image was pulled from, `Build` its BuildKit origin. `Identity` is omitted when
 * the image has neither (for example a `docker load`), so on a containerd-store
 * daemon (`Descriptor` present) a missing `Identity` also means never pulled.
 * Everything else (classic store, older API) keeps the empty-RepoDigests rule.
 */
export async function isLocallyBuiltImage(
  dockerApi: VersionedDockerApi | undefined,
  image: ImageOriginPayload,
  hasRepoDigest: boolean,
): Promise<boolean> {
  if (image.Identity) {
    return !(Array.isArray(image.Identity.Pull) && image.Identity.Pull.length > 0);
  }
  if (image.Descriptor) {
    const apiVersion = await getDaemonApiVersion(dockerApi);
    if (apiVersion && isApiVersionAtLeast(apiVersion, IDENTITY_API_VERSION)) {
      return true;
    }
  }
  return !hasRepoDigest;
}
