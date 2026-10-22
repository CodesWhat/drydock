import { describe, expect, test } from 'vitest';
import { categoryTriggerPaths } from './category-triggers.js';
import { triggerPaths } from './triggers.js';

describe('categoryTriggerPaths', () => {
  test('documents list, get and run routes for actions and notification triggers', () => {
    expect(Object.keys(categoryTriggerPaths).sort()).toEqual([
      '/api/v1/actions',
      '/api/v1/actions/{type}/{name}',
      '/api/v1/actions/{type}/{name}/{agent}',
      '/api/v1/notification-triggers',
      '/api/v1/notification-triggers/{type}/{name}',
      '/api/v1/notification-triggers/{type}/{name}/{agent}',
    ]);
  });

  test('operation ids are unique and none are deprecated', () => {
    const ops = Object.values(categoryTriggerPaths).flatMap((p) => Object.values(p));
    const ids = ops.map((o) => (o as { operationId: string }).operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('listActions');
    expect(ids).toContain('runNotificationTriggerByTypeAndNameAndAgent');
    for (const op of ops) {
      expect(op).not.toHaveProperty('deprecated');
    }
  });

  test('run routes share the legacy response contract', () => {
    expect(categoryTriggerPaths['/api/v1/actions/{type}/{name}'].post.responses[202]).toStrictEqual(
      triggerPaths['/api/v1/triggers/{type}/{name}'].post.responses[202],
    );
    expect(
      categoryTriggerPaths['/api/v1/notification-triggers/{type}/{name}/{agent}'].post.responses,
    ).toHaveProperty('409');
  });
});

describe('legacy triggerPaths', () => {
  test('every operation is flagged deprecated', () => {
    for (const path of Object.values(triggerPaths)) {
      for (const op of Object.values(path)) {
        expect(op).toMatchObject({ deprecated: true });
      }
    }
  });
});
