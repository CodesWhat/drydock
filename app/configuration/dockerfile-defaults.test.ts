import fs from 'node:fs';

describe('Dockerfile release defaults', () => {
  test('release image defaults DD_LOG_FORMAT to text', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toMatch(/FROM base AS release\s+ENV DD_LOG_FORMAT=text/u);
  });

  test('release image pins the available Alpine tzdata revision', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toContain('tzdata=2026c-r0');
    expect(dockerfile).not.toContain('tzdata=2026b-r0');
  });
});
