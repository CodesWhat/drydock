import { parseAcrWebhookPayload } from './acr.js';

describe('parseAcrWebhookPayload', () => {
  test('extracts image and tag from Event Grid image push payload', () => {
    const payload = {
      eventType: 'Microsoft.ContainerRegistry.ImagePushed',
      data: {
        target: {
          repository: 'team/api',
          tag: '1.4.0',
        },
      },
      subject: 'team/api:1.4.0',
    };

    expect(parseAcrWebhookPayload(payload)).toStrictEqual([
      {
        image: 'team/api',
        tag: '1.4.0',
      },
    ]);
  });

  test('extracts repository/tag from subject when target fields are missing', () => {
    const payload = [
      {
        eventType: 'Microsoft.ContainerRegistry.ImagePushed',
        data: {
          target: {},
        },
        subject: 'apps/web:latest',
      },
    ];

    expect(parseAcrWebhookPayload(payload)).toStrictEqual([
      {
        image: 'apps/web',
        tag: 'latest',
      },
    ]);
  });

  test('returns empty list for non-image push events', () => {
    const payload = {
      eventType: 'Microsoft.ContainerRegistry.ImageDeleted',
      data: {
        target: {
          repository: 'team/api',
          tag: 'old',
        },
      },
    };

    expect(parseAcrWebhookPayload(payload)).toStrictEqual([]);
  });

  test('returns empty list when tag cannot be resolved', () => {
    const payload = {
      eventType: 'Microsoft.ContainerRegistry.ImagePushed',
      data: {
        target: {
          repository: 'team/api',
        },
      },
      subject: 'team/api',
    };

    expect(parseAcrWebhookPayload(payload)).toStrictEqual([]);
  });
});
