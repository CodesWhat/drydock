import { parseQuayWebhookPayload } from './quay.js';

describe('parseQuayWebhookPayload', () => {
  test('extracts repository and updated_tags from Quay payload', () => {
    const payload = {
      repository: 'org/service',
      updated_tags: ['1.0.0', 'latest'],
    };

    expect(parseQuayWebhookPayload(payload)).toStrictEqual([
      {
        image: 'org/service',
        tag: '1.0.0',
      },
      {
        image: 'org/service',
        tag: 'latest',
      },
    ]);
  });

  test('falls back to docker_url when repository is unavailable', () => {
    const payload = {
      docker_url: 'quay.io/codeswhat/drydock',
      updated_tags: ['stable'],
    };

    expect(parseQuayWebhookPayload(payload)).toStrictEqual([
      {
        image: 'codeswhat/drydock',
        tag: 'stable',
      },
    ]);
  });

  test('returns empty list when updated_tags is missing', () => {
    const payload = {
      repository: 'org/service',
    };

    expect(parseQuayWebhookPayload(payload)).toStrictEqual([]);
  });

  test('returns empty list when image cannot be resolved', () => {
    const payload = {
      updated_tags: ['latest'],
      docker_url: 'https://',
      homepage: 'http://',
    };

    expect(parseQuayWebhookPayload(payload)).toStrictEqual([]);
  });

  test('returns empty list for non-object payloads', () => {
    expect(parseQuayWebhookPayload(undefined)).toStrictEqual([]);
    expect(parseQuayWebhookPayload(false)).toStrictEqual([]);
  });
});
