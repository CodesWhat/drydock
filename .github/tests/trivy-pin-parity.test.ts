import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Trivy used to be pinned in three places (the Dockerfile trivy-bin stage, the default scanner
// worker image and the release SBOM job) and drifted when only one moved. The image no longer
// bundles Trivy and the release SBOM comes from Syft, so the scanner worker default in
// app/configuration/index.ts is the single Trivy pin, and Renovate tracks it through the
// worker-image regex manager.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(`${repoRoot}/${relative}`, 'utf8');

describe('single Trivy pin', () => {
  test('the scanner worker default is the only Trivy image pin', () => {
    expect(read('app/configuration/index.ts')).toMatch(
      /DEFAULT_TRIVY_WORKER_IMAGE =\s*'ghcr\.io\/aquasecurity\/trivy:[\w.-]+@sha256:[a-f0-9]{64}'/u,
    );
    for (const file of ['Dockerfile', '.github/workflows/release-cut.yml']) {
      expect(read(file)).not.toMatch(/aquasec(urity)?\/trivy/u);
    }
  });

  test('Renovate tracks the worker pin and has no leftover Trivy digest manager', () => {
    const config = JSON.parse(read('renovate.json'));
    const trivyManagers = config.customManagers.filter((m: { description?: string }) =>
      m.description?.includes('Trivy'),
    );
    expect(trivyManagers).toHaveLength(1);
    expect(trivyManagers[0].managerFilePatterns).toEqual(['/^app/configuration/index\\.ts$/']);
    expect(trivyManagers[0].datasourceTemplate).toBe('docker');
    expect(
      config.packageRules.some((r: { matchPackageNames?: string[] }) =>
        r.matchPackageNames?.includes('aquasec/trivy'),
      ),
    ).toBe(false);
  });
});
