import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import { getErrorMessage } from '../../util/error.js';
import { uniqStrings } from '../../util/string-array.js';
import { createUpdatePolicyHandlers } from './update-policy.js';

function createHarness(containerOverrides: Record<string, unknown> = {}) {
  const container = {
    id: 'c1',
    ...containerOverrides,
  };

  const storeContainer = {
    getContainer: vi.fn(() => container),
    updateContainer: vi.fn((value) => value),
  };

  const deps = {
    storeContainer,
    uniqStrings: vi.fn((values: string[]) => uniqStrings(values)),
    getErrorMessage: vi.fn((error: unknown) => getErrorMessage(error)),
    redactContainerRuntimeEnv: vi.fn((value) => value),
  };

  return {
    deps,
    storeContainer,
    handlers: createUpdatePolicyHandlers(deps),
  };
}

function callPatchContainerUpdatePolicy(
  handlers: ReturnType<typeof createUpdatePolicyHandlers>,
  body: unknown,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  handlers.patchContainerUpdatePolicy({ params: { id }, body } as any, res as any);
  return res;
}

function getUpdatedPolicy(storeContainer: { updateContainer: ReturnType<typeof vi.fn> }) {
  return storeContainer.updateContainer.mock.calls[0]?.[0]?.updatePolicy;
}

describe('api/container/update-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('policy normalization', () => {
    test('normalizes existing policy arrays and snooze date before applying actions', () => {
      const harness = createHarness({
        updateKind: { kind: 'tag', remoteValue: '2.0.0' },
        updatePolicy: {
          skipTags: ['1.0.0', '1.0.0', 123],
          skipDigests: ['sha256:abc', 'sha256:abc', false],
          snoozeUntil: '2099-01-01T00:00:00-05:00',
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'skip-current' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        skipTags: ['1.0.0', '2.0.0'],
        skipDigests: ['sha256:abc'],
        snoozeUntil: '2099-01-01T05:00:00.000Z',
      });
    });

    test('drops empty skip arrays and invalid snooze dates from normalized policy', () => {
      const harness = createHarness({
        updatePolicy: {
          skipTags: [],
          skipDigests: [],
          snoozeUntil: 'not-a-date',
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'clear-skips' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toBeUndefined();
    });

    test('keeps non-empty normalized values after unsnooze', () => {
      const harness = createHarness({
        updatePolicy: {
          skipTags: ['2.0.0', '2.0.0'],
          snoozeUntil: '2099-01-01T00:00:00.000Z',
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'unsnooze' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        skipTags: ['2.0.0'],
      });
    });
  });

  describe('snooze date validation', () => {
    test('normalizes explicit snoozeUntil to ISO timestamp', () => {
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'snooze',
        snoozeUntil: '2099-04-01T12:30:00-04:00',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        snoozeUntil: '2099-04-01T16:30:00.000Z',
      });
    });

    test.each([
      [
        'invalid snoozeUntil',
        { action: 'snooze', snoozeUntil: 'not-a-date' },
        'Invalid snoozeUntil date',
      ],
      ['days is zero', { action: 'snooze', days: 0 }, 'Invalid snooze days value'],
      ['days exceeds max', { action: 'snooze', days: 366 }, 'Invalid snooze days value'],
      ['days is NaN', { action: 'snooze', days: 'NaN' }, 'Invalid snooze days value'],
    ])('returns 400 when %s', (_label, body, expectedError) => {
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, body);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: expectedError });
      expect(harness.storeContainer.updateContainer).not.toHaveBeenCalled();
    });

    test('defaults snooze action to seven days from now when days is omitted', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'snooze' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        snoozeUntil: '2026-03-08T00:00:00.000Z',
      });
    });

    test('accepts numeric day strings and computes snoozeUntil from current time', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'snooze',
        days: '30',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        snoozeUntil: '2026-03-31T00:00:00.000Z',
      });
    });
  });

  describe('error handling', () => {
    test('returns a generic error when unexpected failures occur', () => {
      const harness = createHarness();
      harness.storeContainer.updateContainer.mockImplementation(() => {
        throw new Error('database write failed: credentials mismatch');
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'clear' });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to update container policy' });
    });
  });
});
