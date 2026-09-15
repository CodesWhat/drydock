import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Alpine rotates apk package revisions (cosign 3.0.6-r1 -> -r2 on
// 2026-09-06) with no advance notice, and Renovate has no built-in manager
// for `apk add --no-cache name=version-rN` pins — dependency-review and
// Renovate's own `dockerfile` manager only see the image tag/digest on the
// FROM line, not the packages installed inside it. Without something
// watching them, every apk pin rots silently until a build breaks on every
// open PR at once.
//
// renovate.json's customManagers now carries a regex manager that extracts
// every `name=version-rN` pin out of the Dockerfile and resolves it through
// the repology datasource (Renovate has no native apk datasource; repology's
// alpine_3_24 repository is what Renovate documents for tracking apk
// packages, and 3.24 is the Alpine release the Dockerfile's own
// `alpine:3.24` healthcheck-build stage pins). This test proves the regex
// itself is wired correctly by running it against the live Dockerfile text,
// the same way the source-of-truth would be exercised at Renovate runtime —
// it cannot prove repology actually resolves a version for each package,
// since that requires a live network call this suite does not make.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const dockerfilePath = `${repoRoot}/Dockerfile`;
const renovateConfigPath = `${repoRoot}/renovate.json`;

interface CustomManager {
  customType?: string;
  description?: string;
  managerFilePatterns?: string[];
  matchStrings?: string[];
  datasourceTemplate?: string;
  packageNameTemplate?: string;
  versioningTemplate?: string;
}

interface RenovateConfig {
  customManagers?: CustomManager[];
}

function readDockerfile(): string {
  return readFileSync(dockerfilePath, 'utf8');
}

function readRenovateConfig(): RenovateConfig {
  return JSON.parse(readFileSync(renovateConfigPath, 'utf8')) as RenovateConfig;
}

/** Every `name=version-rN` apk pin actually present in the Dockerfile. */
function extractDockerfilePins(dockerfile: string): Array<{ name: string; version: string }> {
  const pinPattern = /(?<depName>[a-z][a-z0-9_-]*)=(?<currentValue>[0-9][\w.]*-r\d+)/g;
  return [...dockerfile.matchAll(pinPattern)].map((match) => ({
    name: match.groups?.depName ?? '',
    version: match.groups?.currentValue ?? '',
  }));
}

function findApkPinManager(config: RenovateConfig): CustomManager | undefined {
  return config.customManagers?.find((manager) =>
    manager.managerFilePatterns?.some((pattern) => pattern.includes('Dockerfile')),
  );
}

describe('renovate Dockerfile apk pin manager', () => {
  it('declares a regex customManager scoped to the Dockerfile', () => {
    const manager = findApkPinManager(readRenovateConfig());
    expect(manager).toBeDefined();
    expect(manager?.customType).toBe('regex');
    expect(manager?.managerFilePatterns).toEqual(['/^Dockerfile$/']);
  });

  it('resolves through a datasource that can actually answer for an Alpine package', () => {
    const manager = findApkPinManager(readRenovateConfig());
    // Renovate has no native apk datasource; repology is what Renovate's own
    // docs point at for tracking apk pins, keyed to the Alpine release the
    // Dockerfile's alpine:3.24 stage uses.
    expect(manager?.datasourceTemplate).toBe('repology');
    expect(manager?.packageNameTemplate).toBe('alpine_3_24/{{{depName}}}');
  });

  it("matches every name=version-rN pin the Dockerfile's apk add lines actually contain", () => {
    const dockerfile = readDockerfile();
    const dockerfilePins = extractDockerfilePins(dockerfile);

    // Sanity check on the fixture itself: if this drops to zero, the
    // Dockerfile stopped pinning apk packages and the manager (and this
    // test) are moot.
    expect(dockerfilePins.length).toBeGreaterThan(0);

    const manager = findApkPinManager(readRenovateConfig());
    expect(manager?.matchStrings).toBeDefined();

    for (const matchString of manager!.matchStrings!) {
      const managerPattern = new RegExp(matchString, 'g');
      const managerMatches = [...dockerfile.matchAll(managerPattern)].map((match) => ({
        name: match.groups?.depName,
        version: match.groups?.currentValue,
      }));

      for (const pin of dockerfilePins) {
        expect(managerMatches).toContainEqual({ name: pin.name, version: pin.version });
      }
    }
  });

  it('covers the known apk-pinned packages, including the cosign line that broke CI', () => {
    const dockerfile = readDockerfile();
    const dockerfilePins = extractDockerfilePins(dockerfile).map((pin) => pin.name);

    expect(dockerfilePins).toEqual(
      expect.arrayContaining([
        'bash',
        'git',
        'jq',
        'openssl',
        'su-exec',
        'tini',
        'tzdata',
        'cosign',
        'gcc',
        'musl-dev',
      ]),
    );
  });
});
