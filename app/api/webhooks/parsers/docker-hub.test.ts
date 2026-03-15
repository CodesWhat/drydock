import { parseDockerHubWebhookPayload } from './docker-hub.js';

describe('parseDockerHubWebhookPayload', () => {
  test('extracts repo_name and tag from Docker Hub payload', () => {
    const payload = {
      repository: {
        repo_name: 'codeswhat/drydock',
      },
      push_data: {
        tag: '1.5.0',
      },
    };

    expect(parseDockerHubWebhookPayload(payload)).toStrictEqual([
      {
        image: 'codeswhat/drydock',
        tag: '1.5.0',
      },
    ]);
  });

  test('falls back to namespace/name when repo_name is missing', () => {
    const payload = {
      repository: {
        namespace: 'library',
        name: 'nginx',
      },
      push_data: {
        tag: 'latest',
      },
    };

    expect(parseDockerHubWebhookPayload(payload)).toStrictEqual([
      {
        image: 'library/nginx',
        tag: 'latest',
      },
    ]);
  });

  test('returns an empty list when tag is missing', () => {
    const payload = {
      repository: {
        repo_name: 'codeswhat/drydock',
      },
      push_data: {},
    };

    expect(parseDockerHubWebhookPayload(payload)).toStrictEqual([]);
  });

  test('returns an empty list for non-object payloads', () => {
    expect(parseDockerHubWebhookPayload(undefined)).toStrictEqual([]);
    expect(parseDockerHubWebhookPayload('invalid')).toStrictEqual([]);
  });
});
