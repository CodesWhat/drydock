import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetRecentTerminalSucceededOperationByContainerIdentity,
  mockHasOtherActiveOperationByContainerIdentity,
} = vi.hoisted(() => ({
  mockGetRecentTerminalSucceededOperationByContainerIdentity: vi.fn(() => undefined as unknown),
  mockHasOtherActiveOperationByContainerIdentity: vi.fn(() => false),
}));

vi.mock('../store/update-operation.js', () => ({
  getRecentTerminalSucceededOperationByContainerIdentity: (
    ...args: Parameters<typeof mockGetRecentTerminalSucceededOperationByContainerIdentity>
  ) => mockGetRecentTerminalSucceededOperationByContainerIdentity(...args),
  hasOtherActiveOperationByContainerIdentity: (
    ...args: Parameters<typeof mockHasOtherActiveOperationByContainerIdentity>
  ) => mockHasOtherActiveOperationByContainerIdentity(...args),
}));

import {
  classifyDuplicateOpTerminalStatus,
  DUPLICATE_OP_RECENT_SUCCESS_WINDOW_MS,
  isActiveUpdateConflictError,
  isConflictError,
  isContainerNoLongerExistsError,
  isContainerNotFoundError,
  isDuplicateStyleError,
} from './duplicate-op-classification.js';

beforeEach(() => {
  mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReset();
  mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
  mockHasOtherActiveOperationByContainerIdentity.mockReset();
  mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(false);
});

describe('isContainerNotFoundError', () => {
  test('returns false for falsy inputs', () => {
    expect(isContainerNotFoundError(null)).toBe(false);
    expect(isContainerNotFoundError(undefined)).toBe(false);
    expect(isContainerNotFoundError('')).toBe(false);
    expect(isContainerNotFoundError(0)).toBe(false);
  });

  test('returns false for non-object inputs', () => {
    expect(isContainerNotFoundError('no such container')).toBe(false);
    expect(isContainerNotFoundError(404)).toBe(false);
  });

  test('returns true for statusCode === 404', () => {
    expect(isContainerNotFoundError({ statusCode: 404 })).toBe(true);
  });

  test('returns true for status === 404 (numeric)', () => {
    expect(isContainerNotFoundError({ status: 404 })).toBe(true);
  });

  test('returns false for other numeric statusCode values', () => {
    expect(isContainerNotFoundError({ statusCode: 500 })).toBe(false);
    expect(isContainerNotFoundError({ statusCode: 200 })).toBe(false);
  });

  test('returns false for other numeric status values', () => {
    expect(isContainerNotFoundError({ status: 500 })).toBe(false);
    expect(isContainerNotFoundError({ status: 200 })).toBe(false);
  });

  test('returns false for non-numeric status value', () => {
    expect(isContainerNotFoundError({ status: '404' })).toBe(false);
  });

  test('returns true for message matching "no such container" (case-insensitive)', () => {
    expect(isContainerNotFoundError({ message: 'No such container: nginx' })).toBe(true);
    expect(isContainerNotFoundError({ message: 'NO SUCH CONTAINER: abc' })).toBe(true);
    expect(isContainerNotFoundError({ message: 'no such container' })).toBe(true);
  });

  test('returns false for non-matching messages', () => {
    expect(isContainerNotFoundError({ message: 'pull failed' })).toBe(false);
    expect(isContainerNotFoundError({ message: '' })).toBe(false);
  });

  test('returns false for non-string message', () => {
    expect(isContainerNotFoundError({ message: 404 })).toBe(false);
  });
});

describe('isConflictError', () => {
  test('returns false for falsy inputs', () => {
    expect(isConflictError(null)).toBe(false);
    expect(isConflictError(undefined)).toBe(false);
  });

  test('returns false for non-object inputs', () => {
    expect(isConflictError('conflict')).toBe(false);
  });

  test('returns true for response.status === 409', () => {
    expect(isConflictError({ response: { status: 409 } })).toBe(true);
  });

  test('returns false for other response.status values', () => {
    expect(isConflictError({ response: { status: 200 } })).toBe(false);
    expect(isConflictError({ response: { status: 500 } })).toBe(false);
  });

  test('returns false when no response field', () => {
    expect(isConflictError({ message: 'conflict' })).toBe(false);
  });

  test('returns false when response is not an object', () => {
    expect(isConflictError({ response: 409 })).toBe(false);
    expect(isConflictError({ response: null })).toBe(false);
  });
});

describe('isContainerNoLongerExistsError', () => {
  test('returns false for falsy inputs', () => {
    expect(isContainerNoLongerExistsError(null)).toBe(false);
    expect(isContainerNoLongerExistsError(undefined)).toBe(false);
  });

  test('returns false for non-object inputs', () => {
    expect(isContainerNoLongerExistsError('no longer exists')).toBe(false);
  });

  test('returns true for messages matching "no longer exists" (case-insensitive)', () => {
    expect(
      isContainerNoLongerExistsError({
        message: 'Unable to refresh compose service web because container web no longer exists',
      }),
    ).toBe(true);
    expect(isContainerNoLongerExistsError({ message: 'container web NO LONGER EXISTS' })).toBe(
      true,
    );
  });

  test('returns false for non-matching messages', () => {
    expect(isContainerNoLongerExistsError({ message: 'no such container' })).toBe(false);
    expect(isContainerNoLongerExistsError({ message: 'pull failed' })).toBe(false);
  });

  test('returns false when message is not a string', () => {
    expect(isContainerNoLongerExistsError({ message: 42 })).toBe(false);
    expect(isContainerNoLongerExistsError({})).toBe(false);
  });
});

describe('isActiveUpdateConflictError', () => {
  test('returns false for falsy inputs', () => {
    expect(isActiveUpdateConflictError(null)).toBe(false);
    expect(isActiveUpdateConflictError(undefined)).toBe(false);
  });

  test('returns false when not a 409 conflict error', () => {
    expect(isActiveUpdateConflictError({ response: { status: 500 } })).toBe(false);
    expect(isActiveUpdateConflictError({ message: 'Container update already in progress' })).toBe(
      false,
    );
  });

  test('returns false for 409 with no data field', () => {
    expect(isActiveUpdateConflictError({ response: { status: 409 } })).toBe(false);
  });

  test('returns false for 409 with non-object data', () => {
    expect(isActiveUpdateConflictError({ response: { status: 409, data: 'raw string' } })).toBe(
      false,
    );
  });

  test('returns false for 409 with data.error not matching the active-lock phrase', () => {
    expect(
      isActiveUpdateConflictError({
        response: { status: 409, data: { error: 'Cannot update temporary rollback container' } },
      }),
    ).toBe(false);
    expect(
      isActiveUpdateConflictError({
        response: { status: 409, data: { error: 'Container is snoozed' } },
      }),
    ).toBe(false);
  });

  test('returns false for 409 with data.error being a non-string value', () => {
    expect(isActiveUpdateConflictError({ response: { status: 409, data: { error: 409 } } })).toBe(
      false,
    );
  });

  test('returns true for 409 with "Container update already queued" message', () => {
    expect(
      isActiveUpdateConflictError({
        response: { status: 409, data: { error: 'Container update already queued' } },
      }),
    ).toBe(true);
  });

  test('returns true for 409 with "Container update already in progress" message', () => {
    expect(
      isActiveUpdateConflictError({
        response: { status: 409, data: { error: 'Container update already in progress' } },
      }),
    ).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(
      isActiveUpdateConflictError({
        response: { status: 409, data: { error: 'CONTAINER UPDATE ALREADY IN PROGRESS' } },
      }),
    ).toBe(true);
    expect(
      isActiveUpdateConflictError({
        response: { status: 409, data: { error: 'container update already queued' } },
      }),
    ).toBe(true);
  });
});

describe('isDuplicateStyleError', () => {
  test('returns true for Docker 404', () => {
    expect(isDuplicateStyleError({ statusCode: 404 })).toBe(true);
  });

  test('returns true for 409 conflict', () => {
    expect(isDuplicateStyleError({ response: { status: 409 } })).toBe(true);
  });

  test('returns true for "no longer exists" message', () => {
    expect(isDuplicateStyleError({ message: 'container web no longer exists' })).toBe(true);
  });

  test('returns false for genuine errors', () => {
    expect(isDuplicateStyleError({ message: 'pull denied' })).toBe(false);
    expect(isDuplicateStyleError(new Error('out of memory'))).toBe(false);
    expect(isDuplicateStyleError(null)).toBe(false);
  });
});

describe('classifyDuplicateOpTerminalStatus', () => {
  /**
   * The old (error, containerName, windowMs, identityFilter, excludeOperationId)
   * signature is gone (roadmap 7-STORE, slice 10): the function now takes a
   * single `identityKey: string | undefined` as its 2nd argument and
   * `excludeOperationId` moves up to the 4th slot. There is no more
   * "identity.watcher present/absent" short-circuit — path 3's guard is just
   * `excludeOperationId && identityKey`, and the store functions themselves do
   * strict identityKey equality. Scenarios that only made sense under the old
   * identity-filter object (e.g. "identity.watcher absent skips the lookup")
   * have no equivalent under a single opaque key and are covered below as
   * what they actually become.
   */

  test('returns "failed" for a non-duplicate-style error regardless of recent success', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus(new Error('pull denied'), 'web')).toBe('failed');
  });

  test('returns "failed" for a duplicate-style error when no recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    expect(classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web')).toBe('failed');
    expect(
      classifyDuplicateOpTerminalStatus({ message: 'container web no longer exists' }, 'web'),
    ).toBe('failed');
  });

  test('returns "expired" for a Docker 404 when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web')).toBe('expired');
    expect(mockGetRecentTerminalSucceededOperationByContainerIdentity).toHaveBeenCalledWith(
      'web',
      DUPLICATE_OP_RECENT_SUCCESS_WINDOW_MS,
    );
  });

  test('returns "expired" for a 409 conflict when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus({ response: { status: 409 } }, 'web')).toBe('expired');
  });

  test('returns "expired" for "no longer exists" when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(
      classifyDuplicateOpTerminalStatus({ message: 'container web no longer exists' }, 'nginx'),
    ).toBe('expired');
  });

  test('passes the custom windowMs to getRecentTerminalSucceededOperationByContainerIdentity', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web', 5000);
    expect(mockGetRecentTerminalSucceededOperationByContainerIdentity).toHaveBeenCalledWith(
      'web',
      5000,
    );
  });

  test('passes the identity key through unchanged to the recent success lookup', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });

    expect(
      classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'agent-A::local::web', 5000),
    ).toBe('expired');
    expect(mockGetRecentTerminalSucceededOperationByContainerIdentity).toHaveBeenCalledWith(
      'agent-A::local::web',
      5000,
    );
  });

  test('returns "failed" for null/undefined error', () => {
    expect(classifyDuplicateOpTerminalStatus(null, 'web')).toBe('failed');
    expect(classifyDuplicateOpTerminalStatus(undefined, 'web')).toBe('failed');
  });

  test('returns "expired" for { status: 404 } shape when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus({ status: 404 }, 'web')).toBe('expired');
  });

  test('returns "failed" for { status: 404 } shape when no recent success and no other active op', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(false);
    expect(classifyDuplicateOpTerminalStatus({ status: 404 }, 'web')).toBe('failed');
  });

  test('409 + active-lock body + excludeOperationId + no recent success → "expired" via isActiveUpdateConflictError (SSE-lag race, issue #421)', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container update already in progress' } } },
        'web',
        undefined,
        'op-loser',
      ),
    ).toBe('expired');
    // Active-lock branch (path 2) is decided from the error body alone — no store hit.
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('409 + active-lock body (queued) + excludeOperationId → "expired"', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container update already queued' } } },
        'web',
        undefined,
        'op-loser',
      ),
    ).toBe('expired');
  });

  test('409 + active-lock body WITHOUT excludeOperationId → "failed" (security gate, fix #4)', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container update already in progress' } } },
        'web',
        // excludeOperationId intentionally omitted
      ),
    ).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('409 + unrelated body (e.g. snoozed blocker) + no recent success + no identity → falls through to "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(true);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container is snoozed' } } },
        undefined,
        undefined,
        'op-loser',
      ),
    ).toBe('failed');
    // Path 3's guard requires a truthy identityKey; store fn skipped without one.
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('409 + no data field + no identity → "failed" (path 3 guard requires identityKey)', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(true);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        undefined,
        undefined,
        'op-loser',
      ),
    ).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('409 + no recent success + other active op + identityKey present → "expired" (issue #421 path 3)', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(true);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        'agent-A::local::web',
        undefined,
        'op-loser',
      ),
    ).toBe('expired');
  });

  test('409 + no recent success + no other active op + identityKey present → "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(false);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        'agent-A::local::web',
        undefined,
        'op-loser',
      ),
    ).toBe('failed');
  });

  test('identityKey undefined → store fn NOT called, result "failed" (absent other signals)', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    const result = classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      undefined,
      undefined,
      'op-loser',
    );
    expect(result).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('identityKey present → store fn called (path 3 guard passes)', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(false);
    classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'agent-X::docker::web',
      undefined,
      'op-excl-99',
    );
    expect(mockHasOtherActiveOperationByContainerIdentity).toHaveBeenCalledWith(
      'agent-X::docker::web',
      'op-excl-99',
    );
  });

  test('active-op check NOT invoked when excludeOperationId is omitted, result is "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    expect(classifyDuplicateOpTerminalStatus({ response: { status: 409 } }, 'web')).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('recent success short-circuits — active-op fn not called', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'agent-A::local::web',
      undefined,
      'op-loser',
    );
    expect(mockHasOtherActiveOperationByContainerIdentity).not.toHaveBeenCalled();
  });

  test('forwards identityKey and excludeOperationId to the store fn', () => {
    mockGetRecentTerminalSucceededOperationByContainerIdentity.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerIdentity.mockReturnValue(true);
    classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'agent-A::local::mycontainer',
      undefined,
      'op-excl-42',
    );
    expect(mockHasOtherActiveOperationByContainerIdentity).toHaveBeenCalledWith(
      'agent-A::local::mycontainer',
      'op-excl-42',
    );
  });
});
