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

  test('returns false for other numeric statusCode values', () => {
    expect(isContainerNotFoundError({ statusCode: 500 })).toBe(false);
    expect(isContainerNotFoundError({ statusCode: 200 })).toBe(false);
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

  test('409 + no recent success + other active op exists → "expired" (issue #421)', () => {
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
    ).toBe('expired');
  });

  test('409 + no recent success + no other active op → "failed"', () => {
    mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);
    mockHasOtherActiveOperationByContainerName.mockReturnValue(false);
    expect(
      classifyDuplicateOpTerminalStatus(
        { response: { status: 409 } },
        'web',
        undefined,
        undefined,
        'op-loser',
      ),
    ).toBe('failed');
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
