import { parseHarborWebhookPayload } from './harbor.js';

describe('parseHarborWebhookPayload', () => {
  test('extracts repository + tags from Harbor PUSH_ARTIFACT payload', () => {
    const payload = {
      type: 'PUSH_ARTIFACT',
      event_data: {
        repository: {
          repo_full_name: 'project/api',
        },
        resources: [{ tag: '1.2.3' }, { tag: 'latest' }],
      },
    };

    expect(parseHarborWebhookPayload(payload)).toStrictEqual([
      {
        image: 'project/api',
        tag: '1.2.3',
      },
      {
        image: 'project/api',
        tag: 'latest',
      },
    ]);
  });

  test('falls back to resource_url when repository info is missing', () => {
    const payload = {
      event_data: {
        resources: [
          {
            tag: '2.0.0',
            resource_url: 'harbor.example.com/team/service:2.0.0',
          },
        ],
      },
    };

    expect(parseHarborWebhookPayload(payload)).toStrictEqual([
      {
        image: 'team/service',
        tag: '2.0.0',
      },
    ]);
  });

  test('returns empty list when resource tags are missing', () => {
    const payload = {
      event_data: {
        repository: {
          repo_full_name: 'project/api',
        },
        resources: [{}],
      },
    };

    expect(parseHarborWebhookPayload(payload)).toStrictEqual([]);
  });

  test('drops tagged resources when image cannot be resolved', () => {
    const payload = {
      event_data: {
        resources: [
          {
            tag: '2.0.0',
          },
        ],
      },
    };

    expect(parseHarborWebhookPayload(payload)).toStrictEqual([]);
  });

  test('returns empty list for invalid payloads', () => {
    expect(parseHarborWebhookPayload(undefined)).toStrictEqual([]);
    expect(parseHarborWebhookPayload('bad')).toStrictEqual([]);
  });

  test('returns empty list when Harbor resources payload is not an array', () => {
    const payload = {
      event_data: {
        repository: {
          repo_full_name: 'project/api',
        },
        resources: {
          tag: '1.0.0',
        },
      },
    };

    expect(parseHarborWebhookPayload(payload)).toStrictEqual([]);
  });
});
