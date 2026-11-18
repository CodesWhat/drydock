import { notificationSilencePaths } from './notification-silences.js';

describe('notificationSilencePaths', () => {
  test('declares list, create and delete', () => {
    const collection = notificationSilencePaths['/api/v1/notifications/silences'];
    expect(Object.keys(collection)).toEqual(['get', 'post']);
    expect(collection.post.operationId).toBe('createNotificationSilence');
    expect(Object.keys(collection.post.responses)).toEqual(['201', '400', '401', '404', '500']);
    const item = notificationSilencePaths['/api/v1/notifications/silences/{id}'];
    expect(Object.keys(item)).toEqual(['delete']);
    expect(item.delete.responses[204]).toEqual({ description: 'No content' });
  });
});
