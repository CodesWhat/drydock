import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('check-dockerfile-base-indexes.sh', import.meta.url));

const OCI_INDEX = 'application/vnd.oci.image.index.v1+json';
const DOCKER_LIST = 'application/vnd.docker.distribution.manifest.list.v2+json';
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';

const NODE_REF =
  'node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf';
const ALPINE_REF =
  'alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

function fixtureKey(ref) {
  return ref.replaceAll(/[^A-Za-z0-9]/gu, '_');
}

function index(platforms, mediaType = OCI_INDEX) {
  const manifests = platforms.map((platform) => {
    const [os, architecture, variant] = platform.split('/');
    return {
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      digest: `sha256:${'0'.repeat(64)}`,
      platform: variant ? { os, architecture, variant } : { os, architecture },
    };
  });
  return mediaType === null ? { manifests } : { mediaType, manifests };
}

function singlePlatformManifest() {
  return {
    mediaType: OCI_MANIFEST,
    config: { mediaType: 'application/vnd.oci.image.config.v1+json' },
    layers: [],
  };
}

/**
 * Runs the guard against a throwaway Dockerfile with a fake `docker` first on
 * PATH, so the parsing and platform-matching logic is exercised with no network.
 */
async function runGuard({
  dockerfile,
  manifests = {},
  platforms = 'linux/amd64,linux/arm64',
  args,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'drydock-base-index-'));
  const fixtureDir = join(dir, 'fixtures');
  const dockerfilePath = join(dir, 'Dockerfile');

  await writeFile(dockerfilePath, dockerfile ?? '');
  await mkdir(fixtureDir, { recursive: true });
  for (const [ref, manifest] of Object.entries(manifests)) {
    await writeFile(join(fixtureDir, fixtureKey(ref)), JSON.stringify(manifest));
  }

  const fakeDocker = join(dir, 'docker');
  await writeFile(
    fakeDocker,
    `#!/bin/sh
# docker buildx imagetools inspect --raw <ref>
ref="$5"
key="$(printf '%s' "$ref" | tr -c 'A-Za-z0-9' '_')"
if [ -f "$DOCKER_FIXTURE_DIR/$key" ]; then
  cat "$DOCKER_FIXTURE_DIR/$key"
  exit 0
fi
echo "ERROR: manifest unknown: $ref" >&2
exit 1
`,
  );
  await chmod(fakeDocker, 0o755);

  try {
    const { stdout, stderr } = await execFileAsync(
      'bash',
      [scriptPath, ...(args ?? [dockerfilePath, platforms])],
      {
        env: {
          ...process.env,
          DOCKER_FIXTURE_DIR: fixtureDir,
          PATH: `${dir}:${process.env.PATH}`,
        },
      },
    );
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    return { code: error.code, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('passes when every pinned base image is an index covering both platforms', async () => {
  const result = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\nFROM base AS app-build\nFROM ${ALPINE_REF} AS healthcheck-build\n`,
    manifests: {
      [NODE_REF]: index(['linux/amd64', 'linux/arm64']),
      [ALPINE_REF]: index(['linux/amd64', 'linux/arm64']),
    },
  });

  assert.equal(result.code, 0);
  assert.match(result.output, /ok: node:24-alpine@sha256:e67514e5/u);
  assert.match(result.output, /All base image pins/u);
});

test('rejects a per-platform manifest pin, the drydock#1021 shape', async () => {
  const result = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\n`,
    manifests: { [NODE_REF]: singlePlatformManifest() },
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /pinned to a single-platform manifest/u);
  assert.match(result.output, /drydock#1021/u);
});

test('rejects an index that is missing a required platform', async () => {
  const result = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\n`,
    manifests: { [NODE_REF]: index(['linux/amd64', 'linux/s390x']) },
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /missing linux\/arm64/u);
  assert.match(result.output, /has: linux\/amd64 linux\/s390x/u);
});

test('ignores unknown/unknown attestation entries and arch variants', async () => {
  const result = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\n`,
    manifests: {
      [NODE_REF]: index(['linux/amd64', 'unknown/unknown', 'linux/arm64/v8', 'unknown/unknown']),
    },
  });

  assert.equal(result.code, 0);
});

test('normalizes variants in the requested platform list too', async () => {
  const result = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\n`,
    manifests: { [NODE_REF]: index(['linux/amd64', 'linux/arm64']) },
    platforms: 'linux/amd64,linux/arm64/v8',
  });

  assert.equal(result.code, 0);
});

test('accepts a docker manifest list and an index with no declared mediaType', async () => {
  const listResult = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\n`,
    manifests: { [NODE_REF]: index(['linux/amd64', 'linux/arm64'], DOCKER_LIST) },
  });
  const untypedResult = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\n`,
    manifests: { [NODE_REF]: index(['linux/amd64', 'linux/arm64'], null) },
  });

  assert.equal(listResult.code, 0);
  assert.equal(untypedResult.code, 0);
});

test('reads through FROM flags and skips stage-name FROM lines', async () => {
  const result = await runGuard({
    dockerfile: [
      '# comment',
      `FROM --platform=$BUILDPLATFORM ${NODE_REF} AS base`,
      'FROM base AS app-build',
      'FROM scratch',
      '',
    ].join('\n'),
    manifests: { [NODE_REF]: index(['linux/amd64', 'linux/arm64']) },
  });

  assert.equal(result.code, 0);
  assert.match(result.output, /Checking 1 digest-pinned base image/u);
});

test('inspects each distinct ref once', async () => {
  const result = await runGuard({
    dockerfile: `FROM ${NODE_REF} AS base\nFROM ${NODE_REF} AS second\n`,
    manifests: { [NODE_REF]: index(['linux/amd64', 'linux/arm64']) },
  });

  assert.equal(result.code, 0);
  assert.match(result.output, /Checking 1 digest-pinned base image/u);
});

test('fails when the Dockerfile pins nothing by digest', async () => {
  const result = await runGuard({ dockerfile: 'FROM node:24-alpine AS base\n' });

  assert.equal(result.code, 1);
  assert.match(result.output, /no digest-pinned FROM instructions/u);
});

test('fails loudly when the manifest cannot be inspected', async () => {
  const result = await runGuard({ dockerfile: `FROM ${NODE_REF} AS base\n` });

  assert.equal(result.code, 1);
  assert.match(result.output, /could not inspect the manifest/u);
});

test('exits 2 on a usage error', async () => {
  const missingArgs = await runGuard({ dockerfile: 'FROM scratch\n', args: [] });
  const missingFile = await runGuard({
    dockerfile: 'FROM scratch\n',
    args: ['/nonexistent/Dockerfile', 'linux/amd64'],
  });

  assert.equal(missingArgs.code, 2);
  assert.match(missingArgs.output, /Usage:/u);
  assert.equal(missingFile.code, 2);
  assert.match(missingFile.output, /Dockerfile not found/u);
});
