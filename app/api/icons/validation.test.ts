import { iconRequestSchema } from './validation.js';

describe('icons/validation', () => {
  test('accepts known providers and normalized slug characters', () => {
    const result = iconRequestSchema.validate({
      provider: 'simple',
      slug: 'Docker-Icon_1.2',
    });

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      provider: 'simple',
      slug: 'Docker-Icon_1.2',
    });
  });

  test('rejects unknown providers', () => {
    const result = iconRequestSchema.validate({
      provider: 'unknown',
      slug: 'docker',
    });

    expect(result.error).toBeDefined();
  });

  test('rejects slugs with path traversal characters', () => {
    const result = iconRequestSchema.validate({
      provider: 'simple',
      slug: '../docker',
    });

    expect(result.error).toBeDefined();
  });
});
