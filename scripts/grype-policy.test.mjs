import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
const grypeConfig = readFileSync(path.join(repositoryRoot, '.grype.yaml'), 'utf8');

test('image does not bundle Trivy or cosign binaries', () => {
  assert.doesNotMatch(dockerfile, /AS trivy-bin/u);
  assert.doesNotMatch(dockerfile, /COPY --from=trivy-bin/u);
  assert.doesNotMatch(dockerfile, /apk add[^\n]*(trivy|cosign)/u);
  assert.doesNotMatch(dockerfile, /^\s+cosign=/mu);
});

test('Grype policy has no ignore rules scoped to vendored binary locations', () => {
  const activeLines = grypeConfig
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#') && line.trim() !== '');

  assert.doesNotMatch(activeLines.join('\n'), /location:/u);
  assert.doesNotMatch(activeLines.join('\n'), /^ignore:/mu);
});
