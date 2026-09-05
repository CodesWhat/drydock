import fs from 'node:fs';

describe('Dockerfile release defaults', () => {
  test('release image defaults DD_LOG_FORMAT to text', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toMatch(/FROM base AS release\s+ENV DD_LOG_FORMAT=text/u);
  });

  test('release image builds from the digest-pinned Node base image', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain(
      'FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base',
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

  test('release image copies Trivy from the digest-pinned multi-arch image', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain(
      'FROM aquasec/trivy@sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c AS trivy-bin',
    );
    expect(dockerfile).toContain('COPY --from=trivy-bin /usr/local/bin/trivy /usr/local/bin/trivy');
    expect(dockerfile).not.toContain('alpine/edge/testing');
    expect(dockerfile).not.toMatch(/apk add[^\n]*trivy/u);
  });

  test('release image pins the available Alpine tzdata revision', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain('tzdata=2026c-r0');
    expect(dockerfile).not.toContain('tzdata=2026b-r0');
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
});
