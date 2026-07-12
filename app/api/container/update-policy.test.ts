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
    recordAuditEvent: vi.fn(),
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

function createLayeredHarness(containerOverrides: Record<string, unknown> = {}) {
  return createHarness({
    updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
    updatePolicyDeclarative: {
      env: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      label: {},
    },
    updatePolicyOverrides: {},
    updatePolicySources: { maturityMode: 'env', maturityMinAgeDays: 'env' },
    ...containerOverrides,
  });
}

describe('api/container/update-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('request validation', () => {
    test('returns 400 when the body is missing', () => {
      const harness = createHarness();
      const res = callPatchContainerUpdatePolicy(harness.handlers, undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Action is required' });
    });

    test('returns 400 when body is a primitive and action cannot be read', () => {
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, 42);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Action is required' });
      expect(harness.storeContainer.updateContainer).not.toHaveBeenCalled();
    });
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

  describe('skip policy actions', () => {
    test('removes digest skip entries when action is remove-skip for digest kind', () => {
      const harness = createHarness({
        updatePolicy: {
          skipTags: ['2.0.0'],
          skipDigests: ['sha256:abc', 'sha256:def', 'sha256:def'],
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'remove-skip',
        kind: 'digest',
        value: 'sha256:abc',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        skipTags: ['2.0.0'],
        skipDigests: ['sha256:def'],
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

  describe('maturity policy actions', () => {
    test('sets mature-only policy with default threshold when minAgeDays is omitted', () => {
      const harness = createHarness({
        updatePolicy: {
          skipTags: ['2.0.0'],
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'set-maturity-policy',
        mode: 'mature',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        skipTags: ['2.0.0'],
        maturityMode: 'mature',
        maturityMinAgeDays: 7,
      });
    });

    test('sets maturity policy mode and threshold', () => {
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'set-maturity-policy',
        mode: 'all',
        minAgeDays: 3,
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        maturityMode: 'all',
        maturityMinAgeDays: 3,
      });
    });

    test('clears maturity policy fields while keeping other policy values', () => {
      const harness = createHarness({
        updatePolicy: {
          skipTags: ['2.0.0'],
          maturityMode: 'mature',
          maturityMinAgeDays: 10,
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'clear-maturity-policy',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(getUpdatedPolicy(harness.storeContainer)).toEqual({
        skipTags: ['2.0.0'],
      });
    });

    test('reverts one UI override field to the declarative label/env value', () => {
      const harness = createHarness({
        updatePolicy: {
          maturityMode: 'all',
          maturityMinAgeDays: 14,
        },
        updatePolicyDeclarative: {
          env: { maturityMode: 'mature', maturityMinAgeDays: 7 },
          label: { maturityMinAgeDays: 14 },
        },
        updatePolicyOverrides: { maturityMode: 'all' },
        updatePolicySources: {
          maturityMode: 'override',
          maturityMinAgeDays: 'label',
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'revert-to-declarative',
        field: 'maturityMode',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      const updated = harness.storeContainer.updateContainer.mock.calls[0]?.[0];
      expect(updated.updatePolicy).toEqual({
        maturityMode: 'mature',
        maturityMinAgeDays: 14,
      });
      expect(updated.updatePolicyOverrides).toEqual({});
      expect(updated.updatePolicySources).toEqual({
        maturityMode: 'env',
        maturityMinAgeDays: 'label',
      });
      expect(harness.deps.recordAuditEvent).toHaveBeenCalledWith({
        action: 'update-policy-override-cleared',
        status: 'success',
        container: updated,
        details: expect.any(String),
      });
      expect(JSON.parse(harness.deps.recordAuditEvent.mock.calls[0][0].details)).toEqual({
        operation: 'revert-to-declarative',
        fields: {
          maturityMode: {
            env: 'mature',
            label: null,
            override: null,
            effective: 'mature',
            source: 'env',
          },
        },
      });
    });

    test('audits set overrides with every tier value after persistence succeeds', () => {
      const harness = createHarness({
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 14 },
        updatePolicyDeclarative: {
          env: { maturityMode: 'mature', maturityMinAgeDays: 7 },
          label: { maturityMinAgeDays: 14 },
        },
        updatePolicyOverrides: {},
        updatePolicySources: { maturityMode: 'env', maturityMinAgeDays: 'label' },
      });

      callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'set-maturity-policy',
        mode: 'all',
        minAgeDays: 21,
      });

      expect(harness.deps.recordAuditEvent).toHaveBeenCalledTimes(1);
      const auditCall = harness.deps.recordAuditEvent.mock.calls[0][0];
      expect(auditCall.action).toBe('update-policy-override-set');
      expect(JSON.parse(auditCall.details)).toEqual({
        operation: 'set-maturity-policy',
        fields: {
          maturityMode: {
            env: 'mature',
            label: null,
            override: 'all',
            effective: 'all',
            source: 'override',
          },
          maturityMinAgeDays: {
            env: 7,
            label: 14,
            override: 21,
            effective: 21,
            source: 'override',
          },
        },
      });
      expect(harness.storeContainer.updateContainer.mock.invocationCallOrder[0]).toBeLessThan(
        harness.deps.recordAuditEvent.mock.invocationCallOrder[0],
      );
    });

    test('does not audit a no-op revert or a failed store update', () => {
      const noOpHarness = createHarness({
        updatePolicyDeclarative: { env: { maturityMode: 'mature' }, label: {} },
        updatePolicyOverrides: {},
      });
      callPatchContainerUpdatePolicy(noOpHarness.handlers, {
        action: 'revert-to-declarative',
        field: 'maturityMode',
      });
      expect(noOpHarness.deps.recordAuditEvent).not.toHaveBeenCalled();

      const failedHarness = createHarness({
        updatePolicyDeclarative: { env: { maturityMode: 'mature' }, label: {} },
        updatePolicyOverrides: {},
      });
      failedHarness.storeContainer.updateContainer.mockImplementation(() => {
        throw new Error('write failed');
      });
      callPatchContainerUpdatePolicy(failedHarness.handlers, {
        action: 'set-maturity-policy',
        mode: 'all',
      });
      expect(failedHarness.deps.recordAuditEvent).not.toHaveBeenCalled();
    });

    test.each([
      [
        'mode is missing',
        { action: 'set-maturity-policy' },
        'Invalid maturity mode; expected "all" or "mature"',
      ],
      [
        'mode is invalid',
        { action: 'set-maturity-policy', mode: 'fresh' },
        'Invalid maturity mode; expected "all" or "mature"',
      ],
      [
        'minAgeDays is zero',
        { action: 'set-maturity-policy', mode: 'mature', minAgeDays: 0 },
        'Invalid maturity minAgeDays value',
      ],
      [
        'minAgeDays is above max',
        { action: 'set-maturity-policy', mode: 'mature', minAgeDays: 366 },
        'Invalid maturity minAgeDays value',
      ],
      [
        'minAgeDays is fractional',
        { action: 'set-maturity-policy', mode: 'mature', minAgeDays: 3.5 },
        'Invalid maturity minAgeDays value',
      ],
    ])('returns 400 when %s', (_label, body, expectedError) => {
      const harness = createHarness();

      const res = callPatchContainerUpdatePolicy(harness.handlers, body);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: expectedError });
      expect(harness.storeContainer.updateContainer).not.toHaveBeenCalled();
    });
  });

  describe('layered policy actions', () => {
    test.each([
      ['tag', '2.0.0', 'skipTags'],
      ['digest', 'sha256:new', 'skipDigests'],
    ] as const)('skips the current %s using the effective list as the override base', (kind, value, field) => {
      const harness = createLayeredHarness({
        updateKind: { kind, remoteValue: value },
        updatePolicy: {
          maturityMode: 'mature',
          maturityMinAgeDays: 7,
          [field]: ['existing'],
        },
      });

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'skip-current' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(
        harness.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides[field],
      ).toEqual(['existing', value]);
    });

    test('skips the current value when neither effective nor override skip lists exist', () => {
      const harness = createLayeredHarness({
        updateKind: { kind: 'tag', remoteValue: '2.0.0' },
      });
      callPatchContainerUpdatePolicy(harness.handlers, { action: 'skip-current' });
      expect(harness.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides).toEqual(
        {
          skipTags: ['2.0.0'],
        },
      );
    });

    test.each([
      [{ action: 'skip-current' }, {}, 'No current update available to skip'],
      [
        { action: 'skip-current' },
        { updateKind: { kind: 'tag' } },
        'No update value available to skip',
      ],
      [
        { action: 'remove-skip', kind: 'version', value: 'x' },
        {},
        'Invalid remove-skip kind; expected "tag" or "digest"',
      ],
      [
        { action: 'remove-skip', kind: 'tag', value: ' ' },
        {},
        'Invalid remove-skip value; expected a non-empty string',
      ],
      [
        { action: 'remove-skip', kind: 'tag', value: 42 },
        {},
        'Invalid remove-skip value; expected a non-empty string',
      ],
      [
        { action: 'set-maturity-policy', mode: 'fresh' },
        {},
        'Invalid maturity mode; expected "all" or "mature"',
      ],
      [
        { action: 'revert-to-declarative', field: 'unknown' },
        {},
        'Invalid declarative policy field',
      ],
      [{ action: 'not-real' }, {}, 'Unknown action not-real'],
    ])('rejects invalid layered action %#', (body, overrides, error) => {
      const harness = createLayeredHarness(overrides);
      const res = callPatchContainerUpdatePolicy(harness.handlers, body);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error });
    });

    test.each([
      ['tag', 'skipTags'],
      ['digest', 'skipDigests'],
    ] as const)('removes a layered %s skip', (kind, field) => {
      const harness = createLayeredHarness({
        updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7, [field]: ['old', 'keep'] },
        updatePolicyOverrides: { [field]: ['old', 'keep'] },
      });
      callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'remove-skip',
        kind,
        value: 'old',
      });
      expect(
        harness.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides[field],
      ).toEqual(['keep']);
    });

    test('supports layered clear, snooze, unsnooze, maturity-clear, and whole revert actions', () => {
      const clearSkips = createLayeredHarness();
      callPatchContainerUpdatePolicy(clearSkips.handlers, { action: 'clear-skips' });
      expect(
        clearSkips.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides,
      ).toMatchObject({
        skipTags: [],
        skipDigests: [],
      });

      const snooze = createLayeredHarness();
      callPatchContainerUpdatePolicy(snooze.handlers, {
        action: 'snooze',
        snoozeUntil: '2030-01-01T00:00:00.000Z',
      });
      expect(
        snooze.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides.snoozeUntil,
      ).toBe('2030-01-01T00:00:00.000Z');

      const unsnooze = createLayeredHarness({
        updatePolicyOverrides: { snoozeUntil: '2030-01-01T00:00:00.000Z' },
      });
      callPatchContainerUpdatePolicy(unsnooze.handlers, { action: 'unsnooze' });
      expect(
        unsnooze.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides,
      ).toEqual({});

      const clearMaturity = createLayeredHarness({
        updatePolicyOverrides: { maturityMode: 'mature', maturityMinAgeDays: 21 },
      });
      callPatchContainerUpdatePolicy(clearMaturity.handlers, { action: 'clear-maturity-policy' });
      expect(
        clearMaturity.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides,
      ).toEqual({
        maturityMode: 'all',
      });

      const revertAll = createLayeredHarness({
        updatePolicyOverrides: {
          maturityMode: 'all',
          skipTags: [],
          snoozeUntil: '2030-01-01T00:00:00.000Z',
        },
      });
      callPatchContainerUpdatePolicy(revertAll.handlers, { action: 'revert-to-declarative' });
      expect(
        revertAll.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides,
      ).toEqual({
        snoozeUntil: '2030-01-01T00:00:00.000Z',
      });

      const clear = createLayeredHarness({ updatePolicyOverrides: { maturityMode: 'all' } });
      callPatchContainerUpdatePolicy(clear.handlers, { action: 'clear' });
      expect(clear.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides).toEqual(
        {},
      );
    });

    test('does not audit setting an override to the same normalized value', () => {
      const harness = createLayeredHarness({
        updatePolicy: { maturityMode: 'all', maturityMinAgeDays: 7 },
        updatePolicyOverrides: { maturityMode: 'all', maturityMinAgeDays: 7 },
      });
      callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'set-maturity-policy',
        mode: 'all',
        minAgeDays: 7,
      });
      expect(harness.deps.recordAuditEvent).not.toHaveBeenCalled();
    });

    test('removes a skip from an empty effective layered list', () => {
      const harness = createLayeredHarness();
      callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'remove-skip',
        kind: 'digest',
        value: 'sha256:none',
      });
      expect(harness.storeContainer.updateContainer.mock.calls[0][0].updatePolicyOverrides).toEqual(
        {
          skipDigests: [],
        },
      );
    });

    test('serializes absent and undefined audit tier values as null', () => {
      const harness = createLayeredHarness({
        updatePolicyDeclarative: { env: { maturityMode: undefined }, label: {} },
      });
      harness.storeContainer.updateContainer.mockImplementation((value) => {
        delete value.updatePolicySources;
        return value;
      });

      callPatchContainerUpdatePolicy(harness.handlers, {
        action: 'set-maturity-policy',
        mode: 'mature',
        minAgeDays: 7,
      });

      const details = JSON.parse(harness.deps.recordAuditEvent.mock.calls[0][0].details);
      expect(details.fields.maturityMode).toMatchObject({ env: null, label: null, source: null });
    });
  });

  describe('error handling', () => {
    test('returns 404 when the container does not exist', () => {
      const harness = createHarness();
      harness.storeContainer.getContainer.mockReturnValue(undefined);

      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'clear' });

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('returns 400 for an unknown legacy action', () => {
      const harness = createHarness();
      const res = callPatchContainerUpdatePolicy(harness.handlers, { action: 'not-real' });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Unknown action not-real' });
    });

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
