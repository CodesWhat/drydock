import { describe, expect, test } from 'vitest';
import { cleanupPaths } from './cleanup.js';

describe('cleanupPaths', () => {
  test('documents the list and run operations', () => {
    expect(Object.keys(cleanupPaths)).toStrictEqual(['/api/v1/cleanup', '/api/v1/cleanup/run']);
    expect(cleanupPaths['/api/v1/cleanup'].get.operationId).toBe('listCleanup');
    const run = cleanupPaths['/api/v1/cleanup/run'].post;
    expect(run.operationId).toBe('runCleanup');
    expect(Object.keys(run.responses)).toStrictEqual(['200', '401', '403', '404', '428']);
    expect(run.requestBody.content['application/json'].schema.required).toStrictEqual(['policy']);
  });
});
