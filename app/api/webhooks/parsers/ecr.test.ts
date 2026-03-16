import { parseEcrEventBridgePayload } from './ecr.js';

describe('parseEcrEventBridgePayload', () => {
  test('extracts repository and tag from a successful ECR push event', () => {
    const payload = {
      source: 'aws.ecr',
      'detail-type': 'ECR Image Action',
      detail: {
        'action-type': 'PUSH',
        result: 'SUCCESS',
        'repository-name': 'backend/api',
        'image-tag': '1.2.3',
      },
    };

    expect(parseEcrEventBridgePayload(payload)).toStrictEqual([
      {
        image: 'backend/api',
        tag: '1.2.3',
      },
    ]);
  });

  test('supports EventBridge event arrays', () => {
    const payload = [
      {
        source: 'aws.ecr',
        'detail-type': 'ECR Image Action',
        detail: {
          'action-type': 'PUSH',
          result: 'SUCCESS',
          'repository-name': 'backend/api',
          'image-tag': 'latest',
        },
      },
    ];

    expect(parseEcrEventBridgePayload(payload)).toStrictEqual([
      {
        image: 'backend/api',
        tag: 'latest',
      },
    ]);
  });

  test('returns empty list for non-push or failed actions', () => {
    const failedPayload = {
      source: 'aws.ecr',
      'detail-type': 'ECR Image Action',
      detail: {
        'action-type': 'PUSH',
        result: 'FAILED',
        'repository-name': 'backend/api',
        'image-tag': '1.2.3',
      },
    };
    const deletePayload = {
      source: 'aws.ecr',
      'detail-type': 'ECR Image Action',
      detail: {
        'action-type': 'DELETE',
        result: 'SUCCESS',
        'repository-name': 'backend/api',
        'image-tag': '1.2.3',
      },
    };

    expect(parseEcrEventBridgePayload(failedPayload)).toStrictEqual([]);
    expect(parseEcrEventBridgePayload(deletePayload)).toStrictEqual([]);
  });

  test('returns empty list when image tag is missing', () => {
    const payload = {
      source: 'aws.ecr',
      'detail-type': 'ECR Image Action',
      detail: {
        'action-type': 'PUSH',
        result: 'SUCCESS',
        'repository-name': 'backend/api',
      },
    };

    expect(parseEcrEventBridgePayload(payload)).toStrictEqual([]);
  });

  test('returns empty list for non-object payload entries', () => {
    expect(parseEcrEventBridgePayload('not-an-event')).toStrictEqual([]);
    expect(parseEcrEventBridgePayload([null, 1, 'bad-entry'])).toStrictEqual([]);
  });
});
