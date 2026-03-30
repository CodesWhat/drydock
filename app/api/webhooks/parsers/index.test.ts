import { parseRegistryWebhookPayload } from './index.js';

describe('parseRegistryWebhookPayload', () => {
  test('detects Docker Hub payloads', () => {
    const payload = {
      repository: {
        repo_name: 'codeswhat/drydock',
      },
      push_data: {
        tag: '1.5.0',
      },
    };

    expect(parseRegistryWebhookPayload(payload)).toStrictEqual({
      provider: 'dockerhub',
      references: [{ image: 'codeswhat/drydock', tag: '1.5.0' }],
    });
  });

  test('detects ECR EventBridge payloads', () => {
    const payload = {
      source: 'aws.ecr',
      'detail-type': 'ECR Image Action',
      detail: {
        'action-type': 'PUSH',
        result: 'SUCCESS',
        'repository-name': 'backend/api',
        'image-tag': 'latest',
      },
    };

    expect(parseRegistryWebhookPayload(payload)).toStrictEqual({
      provider: 'ecr',
      references: [{ image: 'backend/api', tag: 'latest' }],
    });
  });

  test('returns undefined when the payload does not match a supported format', () => {
    expect(parseRegistryWebhookPayload({ unsupported: true })).toBeUndefined();
  });
});
