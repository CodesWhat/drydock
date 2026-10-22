import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The bundled Trivy (Dockerfile trivy-bin stage), the default Docker scanner
// worker image (app/configuration/index.ts) and the release SBOM job
// (release-cut.yml TRIVY_IMAGE) must all run the same Trivy. They drifted once
// (0.72.0 vs 0.73.0) because Renovate only bumps the Dockerfile line.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(`${repoRoot}/${relative}`, 'utf8');

const DIGEST = /aquasec\/trivy@sha256:([a-f0-9]{64})/u;

function digestIn(relative: string, pattern: RegExp): string {
  const match = read(relative).match(pattern);
  expect(match, `${relative} must pin aquasec/trivy by digest`).not.toBeNull();
  return match?.[1] as string;
}

describe('Trivy pin parity', () => {
  const dockerfile = digestIn(
    'Dockerfile',
    /FROM aquasec\/trivy@sha256:([a-f0-9]{64}) AS trivy-bin/u,
  );
  const worker = digestIn(
    'app/configuration/index.ts',
    /DEFAULT_TRIVY_WORKER_IMAGE =\s*'aquasec\/trivy@sha256:([a-f0-9]{64})'/u,
  );
  const sbom = digestIn(
    '.github/workflows/release-cut.yml',
    /TRIVY_IMAGE: aquasec\/trivy@sha256:([a-f0-9]{64})/u,
  );

  test('default scanner worker image uses the Dockerfile Trivy digest', () => {
    expect(worker).toBe(dockerfile);
  });

  test('release SBOM job uses the Dockerfile Trivy digest', () => {
    expect(sbom).toBe(dockerfile);
  });

  test('Renovate bumps every Trivy pin together', () => {
    const config = JSON.parse(read('renovate.json'));
    const manager = config.customManagers.find((m: { description?: string }) =>
      m.description?.includes('Trivy'),
    );
    expect(manager.datasourceTemplate).toBe('docker');
    const pattern = new RegExp(manager.matchStrings[0], 'u');
    for (const file of ['app/configuration/index.ts', '.github/workflows/release-cut.yml']) {
      expect(
        manager.managerFilePatterns.some((p: string) => new RegExp(p.slice(1, -1)).test(file)),
      ).toBe(true);
      expect(read(file).match(pattern)?.groups?.currentDigest).toBe(`sha256:${dockerfile}`);
    }
    const rule = config.packageRules.find((r: { matchPackageNames?: string[] }) =>
      r.matchPackageNames?.includes('aquasec/trivy'),
    );
    expect(rule.groupName).toBeTruthy();
    expect(DIGEST.test(read('Dockerfile'))).toBe(true);
  });
});
