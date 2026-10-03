/**
 * The build identity worth showing next to a version, or undefined when it
 * adds nothing.
 *
 * The API reports the base version (`1.6.1`) as `version` and the full build
 * identity (`1.6.1-rc.15`) as `build`. They differ on a stable release, which
 * is the promoted release candidate image. An older server or agent reports no
 * build at all.
 */
export function distinctBuild(version: unknown, build: unknown): string | undefined {
  if (typeof build !== 'string' || build === '' || build === version) {
    return undefined;
  }
  return build;
}
