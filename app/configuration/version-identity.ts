import semver from 'semver';

/**
 * The version a user reads, and the exact build behind it.
 *
 * A stable release is the last release candidate's image promoted byte for
 * byte, so the image published as `1.6.1` was built as `1.6.1-rc.15` and can't
 * know which tag it was pulled by. `version` is the base version to show as
 * the product version; `build` is the full configured value, kept for support
 * and bug reports.
 */
export interface VersionIdentity<T = string> {
  version: T;
  build: T;
}

/**
 * Split a configured version into the base version and the build identity.
 *
 * A semver with a prerelease suffix (`1.6.1-rc.15`) yields its base
 * (`1.6.1`). Everything else is returned unchanged for both fields: a stable
 * semver, a build placeholder (`local`, `ci`, `unknown`), or a non-string.
 * Never throws.
 */
export function deriveVersionIdentity<T>(configuredVersion: T): VersionIdentity<T> {
  if (typeof configuredVersion === 'string') {
    const parsed = semver.parse(configuredVersion);
    if (parsed && parsed.prerelease.length > 0) {
      return {
        version: `${parsed.major}.${parsed.minor}.${parsed.patch}` as T,
        build: configuredVersion,
      };
    }
  }
  return { version: configuredVersion, build: configuredVersion };
}

/**
 * One-line form for logs and the startup banner: the version alone, or
 * `version (build <build>)` when the build says more than the version does.
 */
export function formatVersionIdentity({ version, build }: VersionIdentity): string {
  return build === version ? version : `${version} (build ${build})`;
}
