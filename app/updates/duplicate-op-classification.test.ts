import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetRecentTerminalSucceededOperationByContainerName,
  mockHasOtherActiveOperationByContainerName,
} = vi.hoisted(() => ({
  mockGetRecentTerminalSucceededOperationByContainerName: vi.fn(() => undefined as unknown),
  mockHasOtherActiveOperationByContainerName: vi.fn(() => false),
}));

vi.mock('../store/update-operation.js', () => ({
  getRecentTerminalSucceededOperationByContainerName: (
    ...args: Parameters<typeof mockGetRecentTerminalSucceededOperationByContainerName>
  ) => mockGetRecentTerminalSucceededOperationByContainerName(...args),
  hasOtherActiveOperationByContainerName: (
    ...args: Parameters<typeof mockHasOtherActiveOperationByContainerName>
  ) => mockHasOtherActiveOperationByContainerName(...args),
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
  mockGetRecentTerminalSucceededOperationByContainerName.mockReset();
  mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
  mockHasOtherActiveOperationByContainerName.mockReset();
  mockHasOtherActiveOperationByContainerName.mockReturnValue(false);
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
  test('returns "failed" for a non-duplicate-style error regardless of recent success', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus(new Error('pull denied'), 'web')).toBe('failed');
  });

  test('returns "failed" for a duplicate-style error when no recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    expect(classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web')).toBe('failed');
    expect(
      classifyDuplicateOpTerminalStatus({ message: 'container web no longer exists' }, 'web'),
    ).toBe('failed');
  });

  test('returns "expired" for a Docker 404 when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web')).toBe('expired');
    expect(mockGetRecentTerminalSucceededOperationByContainerName).toHaveBeenCalledWith(
      'web',
      DUPLICATE_OP_RECENT_SUCCESS_WINDOW_MS,
      undefined,
    );
  });

  test('returns "expired" for a 409 conflict when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus({ response: { status: 409 } }, 'web')).toBe('expired');
  });

  test('returns "expired" for "no longer exists" when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(
      classifyDuplicateOpTerminalStatus({ message: 'container web no longer exists' }, 'nginx'),
    ).toBe('expired');
  });

  test('passes the custom windowMs to getRecentTerminalSucceededOperationByContainerName', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web', 5000);
    expect(mockGetRecentTerminalSucceededOperationByContainerName).toHaveBeenCalledWith(
      'web',
      5000,
      undefined,
    );
  });

  test('passes agent and watcher identity to the recent success lookup', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });

    expect(
      classifyDuplicateOpTerminalStatus({ statusCode: 404 }, 'web', 5000, {
        agent: 'agent-A',
        watcher: 'local',
      }),
    ).toBe('expired');
    expect(mockGetRecentTerminalSucceededOperationByContainerName).toHaveBeenCalledWith(
      'web',
      5000,
      { agent: 'agent-A', watcher: 'local' },
    );
  });

  test('returns "failed" for null/undefined error', () => {
    expect(classifyDuplicateOpTerminalStatus(null, 'web')).toBe('failed');
    expect(classifyDuplicateOpTerminalStatus(undefined, 'web')).toBe('failed');
  });

  test('returns "expired" for { status: 404 } shape when a recent success exists', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    expect(classifyDuplicateOpTerminalStatus({ status: 404 }, 'web')).toBe('expired');
  });

  test('returns "failed" for { status: 404 } shape when no recent success and no other active op', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(false);
    expect(classifyDuplicateOpTerminalStatus({ status: 404 }, 'web')).toBe('failed');
  });

  test('409 + active-lock body + no recent success → "expired" via isActiveUpdateConflictError (SSE-lag race, issue #421)', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container update already in progress' } } },
        'web',
      ),
    ).toBe('expired');
    // Active-lock branch requires no store hit and no excludeOperationId/identity.
    expect(mockHasOtherActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('409 + active-lock body (queued) → "expired"', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container update already queued' } } },
        'web',
      ),
    ).toBe('expired');
  });

  test('409 + unrelated body (e.g. snoozed blocker) + no recent success + no identity → falls through to "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(true);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409, data: { error: 'Container is snoozed' } } },
        'web',
        undefined,
        undefined,
        'op-loser',
      ),
    ).toBe('failed');
    // Store fn skipped because identity.watcher is absent.
    expect(mockHasOtherActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('409 + no data field + no identity → "failed" (tightened: store fn not called without identity.watcher)', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(true);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        'web',
        undefined,
        undefined,
        'op-loser',
      ),
    ).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('409 + no recent success + other active op + identity.watcher present → "expired" (issue #421 path 3)', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(true);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        'web',
        undefined,
        { agent: 'agent-A', watcher: 'local' },
        'op-loser',
      ),
    ).toBe('expired');
  });

  test('409 + no recent success + no other active op + identity.watcher present → "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(false);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        'web',
        undefined,
        { agent: 'agent-A', watcher: 'local' },
        'op-loser',
      ),
    ).toBe('failed');
  });

  test('identity undefined → store fn NOT called, result "failed" (absent other signals)', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    const result = classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'web',
      undefined,
      undefined,
      'op-loser',
    );
    expect(result).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('identity with watcher → store fn called (path 3 guard passes)', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(false);
    classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'web',
      undefined,
      { agent: 'agent-X', watcher: 'docker' },
      'op-excl-99',
    );
    expect(mockHasOtherActiveOperationByContainerName).toHaveBeenCalledWith('web', 'op-excl-99', {
      agent: 'agent-X',
      watcher: 'docker',
    });
  });

  test('active-op check NOT invoked when excludeOperationId is omitted, result is "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    expect(classifyDuplicateOpTerminalStatus({ response: { status: 409 } }, 'web')).toBe('failed');
    expect(mockHasOtherActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('recent success short-circuits — active-op fn not called', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
      id: 'prev',
      status: 'succeeded',
    });
    classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'web',
      undefined,
      undefined,
      'op-loser',
    );
    expect(mockHasOtherActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('forwards containerName, excludeOperationId, and identity to the store fn', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(true);
    classifyDuplicateOpTerminalStatus(
      { response: { status: 409 } },
      'mycontainer',
      undefined,
      { agent: 'agent-A', watcher: 'local' },
      'op-excl-42',
    );
    expect(mockHasOtherActiveOperationByContainerName).toHaveBeenCalledWith(
      'mycontainer',
      'op-excl-42',
      { agent: 'agent-A', watcher: 'local' },
    );
  });
});
