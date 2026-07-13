import fs from 'node:fs';

describe('Dockerfile release defaults', () => {
  test('release image defaults DD_LOG_FORMAT to text', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toMatch(/FROM base AS release\s+ENV DD_LOG_FORMAT=text/u);
  });

  test('release image copies Trivy from the digest-pinned multi-arch image', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain(
      'FROM aquasec/trivy@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f AS trivy-bin',
    );
    expect(dockerfile).toContain('COPY --from=trivy-bin /usr/local/bin/trivy /usr/local/bin/trivy');
    expect(dockerfile).not.toContain('alpine/edge/testing');
    expect(dockerfile).not.toMatch(/apk add[^\n]*trivy/u);
  });
});
