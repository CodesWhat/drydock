import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Dockerfile release defaults', () => {
  test('release image defaults DD_LOG_FORMAT to text', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toMatch(/FROM base AS release\s+ENV DD_LOG_FORMAT=text/u);
  });

  test('release image builds from the digest-pinned Node base image', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain(
      'FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS base',
    );
  });

  test('base image pins are image index digests, not per-platform manifests', () => {
    // #1021: rc.4 through rc.10 pinned amd64-only manifest digests, so the
    // arm64 stage built on an amd64 rootfs and shipped x86-64 binaries under
    // an arm64 label. scripts/check-dockerfile-base-indexes.sh enforces this
    // against the registry; this asserts the intent stays written down.
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain(
      'FROM alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS healthcheck-build',
    );
    expect(dockerfile).not.toContain(
      'sha256:2a49bdf71e9fd965a58c1703fd9ddd205b34e5782b692a72dd1d248abb0beb43',
    );
    expect(dockerfile).not.toContain(
      'sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f',
    );

    const indexPinComments = dockerfile.match(/^# .*image index digest/gmu) ?? [];
    expect(indexPinComments.length).toBe(2);
    expect(dockerfile).toMatch(/never a per-platform manifest digest/u);
    expect(dockerfile).toMatch(/\(#1021\)/u);
  });

  test('release image bundles neither Trivy nor cosign', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).not.toContain('trivy-bin');
    expect(dockerfile).not.toContain('aquasec/trivy');
    expect(dockerfile).not.toMatch(/apk add[^\n]*(trivy|cosign)/u);
    expect(dockerfile).not.toMatch(/^\s+cosign=/mu);
    expect(dockerfile).not.toContain('alpine/edge/testing');
  });

  test('release image pins the available Alpine tzdata revision', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain('tzdata=2026e-r0');
    expect(dockerfile).not.toContain('tzdata=2026c-r0');
  });

  test('release image creates the persistent store with owner-only permissions', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
    const entrypoint = fs.readFileSync(
      new URL('../../Docker.entrypoint.sh', import.meta.url),
      'utf8',
    );

    expect(dockerfile).toContain('mkdir -m 0700 /store');
    expect(entrypoint).toMatch(/^umask 077$/mu);
  });

  test('release image strips root from every /etc/group member list', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
    const releaseStage = dockerfile.slice(dockerfile.indexOf('FROM base AS release'));
    const baseStage = dockerfile.slice(
      dockerfile.indexOf('AS base'),
      dockerfile.indexOf('AS healthcheck-build'),
    );

    expect(releaseStage).toMatch(/&& awk -F: [\s\S]*m\[i\] != "root"[\s\S]*\/etc\/group/u);
    expect(releaseStage).toContain('cat /tmp/group.new > /etc/group');
    expect(baseStage).not.toContain('/etc/group');
  });
});

describe('Docker.entrypoint.sh group_add preservation', () => {
  const entrypointPath = fileURLToPath(new URL('../../Docker.entrypoint.sh', import.meta.url));
  let dir: string;

  const writeStub = (name: string, body: string) => {
    const file = path.join(dir, 'bin', name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };

  let server: net.Server | undefined;

  const mountSocket = async () => {
    server = net.createServer();
    await new Promise<void>((resolve) => server?.listen(path.join(dir, 'sock'), resolve));
  };

  const run = (opts: { groups: string; socketGid?: string; etcGroup?: string }) => {
    fs.writeFileSync(path.join(dir, 'status'), `Name:\tx\nGroups:\t${opts.groups}\nUmask:\t0077\n`);
    fs.writeFileSync(
      path.join(dir, 'etc-group'),
      opts.etcGroup ?? 'root:x:0:\nwheel:x:10:\nnode:x:1000:\n',
    );
    fs.writeFileSync(path.join(dir, 'calls'), '');
    const result = spawnSync('bash', [entrypointPath, 'node', 'dist/index.js'], {
      encoding: 'utf8',
      env: {
        PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
        DD_ENTRYPOINT_PROC_STATUS: path.join(dir, 'status'),
        STUB_DIR: dir,
        DD_ENTRYPOINT_DOCKER_SOCK: path.join(dir, 'sock'),
        STUB_SOCKET_GID: opts.socketGid ?? '',
      },
    });
    const calls = fs
      .readFileSync(path.join(dir, 'calls'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    return { result, calls };
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-entrypoint-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    writeStub('id', 'case "$1" in -u) echo 0;; -g) echo 1000;; esac');
    writeStub(
      'getent',
      'awk -F: -v g="$2" \'$3 == g { print; found = 1 } END { exit !found }\' "$STUB_DIR/etc-group"',
    );
    writeStub('addgroup', 'echo "addgroup $*" >> "$STUB_DIR/calls"');
    writeStub('su-exec', 'echo "su-exec $*" >> "$STUB_DIR/calls"');
    writeStub('stat', 'echo "$STUB_SOCKET_GID"');
  });

  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    server = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('keeps no extra groups when the process has no supplementary groups', () => {
    const { result, calls } = run({ groups: '0' });

    expect(result.status).toBe(0);
    expect(calls).toEqual([expect.stringMatching(/^su-exec node /u)]);
    expect(result.stdout).not.toContain('Preserving');
  });

  test('skips node primary GID', () => {
    const { calls } = run({ groups: '1000' });

    expect(calls.filter((c) => c.startsWith('addgroup'))).toEqual([]);
  });

  test('does not carry over the single GID 0 Docker gives every root process', () => {
    const { result, calls } = run({ groups: '0 1000' });

    expect(calls).toEqual([expect.stringMatching(/^su-exec node /u)]);
    expect(result.stdout).not.toContain('Preserving');
  });

  test('adds node to the root group for a group_add of 0', () => {
    const { result, calls } = run({ groups: '0 0' });

    expect(calls).toEqual(['addgroup node root', expect.stringMatching(/^su-exec node /u)]);
    expect(result.stdout).toContain('Preserving group_add supplementary GIDs for node: 0');
  });

  test('creates a named group for a group_add GID with no entry', () => {
    const { result, calls } = run({ groups: '0 4242 0' });

    expect(calls).toEqual([
      'addgroup node root',
      'addgroup -g 4242 -S dd-gid-4242',
      'addgroup node dd-gid-4242',
      expect.stringMatching(/^su-exec node /u),
    ]);
    expect(result.stdout).toContain('node: 0 4242');
  });

  test('keeps the docker socket group alongside group_add GIDs', async () => {
    await mountSocket();
    const { calls } = run({ groups: '0 0', socketGid: '999' });

    expect(calls).toEqual([
      'addgroup -g 999 -S docker',
      'addgroup node docker',
      'addgroup node root',
      expect.stringMatching(/^su-exec node /u),
    ]);
  });

  test('adds only the socket group when the socket is mounted without group_add', async () => {
    await mountSocket();
    const { calls } = run({ groups: '0', socketGid: '999' });

    expect(calls).toEqual([
      'addgroup -g 999 -S docker',
      'addgroup node docker',
      expect.stringMatching(/^su-exec node /u),
    ]);
  });
});
