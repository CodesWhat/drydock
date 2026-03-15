import { parseGhcrWebhookPayload } from './ghcr.js';

describe('parseGhcrWebhookPayload', () => {
  test('extracts image references from registry_package.metadata.container.tags', () => {
    const payload = {
      action: 'published',
      registry_package: {
        package_type: 'container',
        namespace: 'codeswhat',
        name: 'drydock',
        package_version: {
          metadata: {
            container: {
              tags: ['1.5.0', 'latest'],
            },
          },
        },
      },
    };

    expect(parseGhcrWebhookPayload(payload)).toStrictEqual([
      {
        image: 'codeswhat/drydock',
        tag: '1.5.0',
      },
      {
        image: 'codeswhat/drydock',
        tag: 'latest',
      },
    ]);
  });

  test('extracts tags from container_metadata.tags fallback', () => {
    const payload = {
      registry_package: {
        package_type: 'container',
        namespace: 'codeswhat',
        name: 'drydock',
        package_version: {
          container_metadata: {
            tags: ['stable'],
          },
        },
      },
    };

    expect(parseGhcrWebhookPayload(payload)).toStrictEqual([
      {
        image: 'codeswhat/drydock',
        tag: 'stable',
      },
    ]);
  });

  test('returns empty list when package type is not container', () => {
    const payload = {
      registry_package: {
        package_type: 'npm',
        namespace: 'codeswhat',
        name: 'drydock',
        package_version: {
          metadata: {
            container: {
              tags: ['1.5.0'],
            },
          },
        },
      },
    };

    expect(parseGhcrWebhookPayload(payload)).toStrictEqual([]);
  });

  test('returns empty list when tags are not available', () => {
    const payload = {
      registry_package: {
        package_type: 'container',
        namespace: 'codeswhat',
        name: 'drydock',
        package_version: {},
      },
    };

    expect(parseGhcrWebhookPayload(payload)).toStrictEqual([]);
  });
});
