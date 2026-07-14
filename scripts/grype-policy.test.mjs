import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
const grypeConfig = readFileSync(path.join(repositoryRoot, '.grype.yaml'), 'utf8');

test('Grype policy follows the bundled Trivy binary destination', () => {
  const copyMatch = dockerfile.match(
    /^COPY --from=trivy-bin \/usr\/local\/bin\/trivy (?<destination>\S+)$/mu,
  );

  assert.ok(copyMatch?.groups?.destination, 'Dockerfile must copy the pinned Trivy binary');
  assert.match(
    grypeConfig,
    new RegExp(`^\\s+location: "${copyMatch.groups.destination.replaceAll('/', '\\/')}"$`, 'mu'),
  );
});
