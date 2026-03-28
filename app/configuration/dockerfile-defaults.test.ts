import fs from 'node:fs';

describe('Dockerfile release defaults', () => {
  test('release image defaults DD_LOG_FORMAT to text', () => {
    const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

    expect(dockerfile).toMatch(/FROM base AS release\s+ENV DD_LOG_FORMAT=text/u);
  });
});
