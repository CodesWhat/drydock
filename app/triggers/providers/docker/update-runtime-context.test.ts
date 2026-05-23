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

  test('returns undefined when runtime context contains a cycle', () => {
    const cyclic: { runtimeContext?: unknown } = {};
    cyclic.runtimeContext = cyclic;

    expect(getRequestedOperationId({ id: 'container-a' }, cyclic)).toBeUndefined();
  });

  test('reads operationIds from a Map without falling through Object.prototype (#289)', () => {
    expect(
      getRequestedOperationId(
        { id: 'container-a' },
        {
          operationIds: new Map<string, string>([
            ['container-a', '  mapped-op  '],
            ['container-b', 'other-op'],
          ]),
        },
      ),
    ).toBe('mapped-op');

    expect(
      getRequestedOperationId({ id: 'missing' }, { operationIds: new Map([['container-a', 'x']]) }),
    ).toBeUndefined();
  });

  test('ignores operationIds that are truthy but neither a Map nor an object (#289)', () => {
    expect(
      getRequestedOperationId(
        { id: 'container-a' },
        // String is truthy but not Map nor object — exercises the inner-ternary
        // false branch added alongside Map support.
        { operationIds: 'not-a-map' as unknown as Map<string, unknown> },
      ),
    ).toBeUndefined();
  });

  test('rejects __proto__/constructor lookups on a record-shaped operationIds map (#289)', () => {
    // Even when a malicious record arrives with a polluted prototype-chain
    // entry, the lookup must NOT traverse the prototype chain.
    const poisoned = Object.create({
      __proto__: 'evil-proto',
      constructor: 'evil-ctor',
    }) as Record<string, string>;
    poisoned.legit = 'legit-op';

    expect(
      getRequestedOperationId({ id: '__proto__' }, { operationIds: poisoned }),
    ).toBeUndefined();
    expect(
      getRequestedOperationId({ id: 'constructor' }, { operationIds: poisoned }),
    ).toBeUndefined();
    expect(getRequestedOperationId({ id: 'legit' }, { operationIds: poisoned })).toBe('legit-op');
  });
});
