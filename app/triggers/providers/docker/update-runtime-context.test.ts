import { describe, expect, test } from 'vitest';

import {
  getRequestedOperationId,
  normalizeRequestedOperationId,
} from './update-runtime-context.js';

describe('update-runtime-context', () => {
  test('normalizes requested operation ids', () => {
    expect(normalizeRequestedOperationId('  op-123  ')).toBe('op-123');
    expect(normalizeRequestedOperationId('')).toBeUndefined();
    expect(normalizeRequestedOperationId('   ')).toBeUndefined();
    expect(normalizeRequestedOperationId(123)).toBeUndefined();
  });

  test('reads a direct requested operation id before falling back to the batch map', () => {
    expect(
      getRequestedOperationId(
        { id: 'container-a' },
        {
          operationId: '  direct-op  ',
          operationIds: {
            'container-a': 'mapped-op',
          },
        },
      ),
    ).toBe('direct-op');
  });

  test('falls back to per-container operation ids and rejects invalid runtime contexts', () => {
    expect(
      getRequestedOperationId(
        { id: 'container-a' },
        {
          operationIds: {
            'container-a': '  mapped-op  ',
            'container-b': '',
          },
        },
      ),
    ).toBe('mapped-op');

    expect(
      getRequestedOperationId(
        {},
        {
          operationIds: {
            '': 'empty-container-op',
          },
        },
      ),
    ).toBe('empty-container-op');

    expect(getRequestedOperationId({ id: 'container-a' }, undefined)).toBeUndefined();
    expect(getRequestedOperationId({ id: 'container-a' }, {})).toBeUndefined();
    expect(
      getRequestedOperationId({ id: 'missing' }, { operationIds: { 'container-a': 'x' } }),
    ).toBe(undefined);
  });
});
