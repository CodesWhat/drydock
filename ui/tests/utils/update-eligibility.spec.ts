import type { UpdateBlocker, UpdateEligibility } from '@/types/container';
import {
  BLOCKER_SEVERITY,
  getHardBlockers,
  getPrimaryHardBlocker,
  getPrimarySoftBlocker,
  getSoftBlockers,
  hasHardBlocker,
  hasSoftBlocker,
  severityOf,
} from '@/utils/update-eligibility';

function makeBlocker(overrides: Partial<UpdateBlocker> = {}): UpdateBlocker {
  return {
    reason: overrides.reason ?? 'no-update-available',
    message: overrides.message ?? 'No update available.',
    actionable: overrides.actionable ?? false,
    severity: overrides.severity,
    actionHint: overrides.actionHint,
    liftableAt: overrides.liftableAt,
    details: overrides.details,
  };
}

function makeEligibility(overrides: Partial<UpdateEligibility> = {}): UpdateEligibility {
  return {
    eligible: overrides.eligible ?? false,
    blockers: overrides.blockers ?? [],
    evaluatedAt: overrides.evaluatedAt ?? '2026-04-27T00:00:00.000Z',
  };
}

describe('BLOCKER_SEVERITY', () => {
  it('maps hard blockers correctly', () => {
    expect(BLOCKER_SEVERITY['no-update-available']).toBe('hard');
    expect(BLOCKER_SEVERITY['rollback-container']).toBe('hard');
    expect(BLOCKER_SEVERITY['active-operation']).toBe('hard');
    expect(BLOCKER_SEVERITY['security-scan-blocked']).toBe('hard');
    expect(BLOCKER_SEVERITY['agent-mismatch']).toBe('hard');
    expect(BLOCKER_SEVERITY['no-update-trigger-configured']).toBe('hard');
  });

  it('maps soft blockers correctly', () => {
    expect(BLOCKER_SEVERITY['snoozed']).toBe('soft');
    expect(BLOCKER_SEVERITY['skip-tag']).toBe('soft');
    expect(BLOCKER_SEVERITY['skip-digest']).toBe('soft');
    expect(BLOCKER_SEVERITY['maturity-not-reached']).toBe('soft');
    expect(BLOCKER_SEVERITY['threshold-not-reached']).toBe('soft');
    expect(BLOCKER_SEVERITY['trigger-excluded']).toBe('soft');
    expect(BLOCKER_SEVERITY['trigger-not-included']).toBe('soft');
  });
});

describe('severityOf', () => {
  it('returns explicit severity when set', () => {
    const blocker = makeBlocker({ reason: 'snoozed', severity: 'hard' });
    expect(severityOf(blocker)).toBe('hard');
  });

  it('falls back to BLOCKER_SEVERITY map when severity is not set', () => {
    const hard = makeBlocker({ reason: 'active-operation' });
    expect(severityOf(hard)).toBe('hard');

    const soft = makeBlocker({ reason: 'threshold-not-reached' });
    expect(severityOf(soft)).toBe('soft');
  });

  it('defaults to hard for an unknown reason not in the map', () => {
    const blocker = {
      reason: 'unknown-future-reason' as UpdateBlocker['reason'],
      message: '',
      actionable: false,
    };
    expect(severityOf(blocker)).toBe('hard');
  });
});

describe('getHardBlockers', () => {
  it('returns empty array when eligibility is undefined', () => {
    expect(getHardBlockers(undefined)).toEqual([]);
  });

  it('returns empty array when blockers is empty', () => {
    expect(getHardBlockers(makeEligibility())).toEqual([]);
  });

  it('returns only hard-severity blockers', () => {
    const hard = makeBlocker({ reason: 'active-operation' });
    const soft = makeBlocker({ reason: 'snoozed' });
    const result = getHardBlockers(makeEligibility({ blockers: [hard, soft] }));
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('active-operation');
  });

  it('respects explicit severity over map', () => {
    const promoted = makeBlocker({ reason: 'snoozed', severity: 'hard' });
    const result = getHardBlockers(makeEligibility({ blockers: [promoted] }));
    expect(result).toHaveLength(1);
  });
});

describe('getSoftBlockers', () => {
  it('returns empty array when eligibility is undefined', () => {
    expect(getSoftBlockers(undefined)).toEqual([]);
  });

  it('returns empty array when blockers is empty', () => {
    expect(getSoftBlockers(makeEligibility())).toEqual([]);
  });

  it('returns only soft-severity blockers', () => {
    const hard = makeBlocker({ reason: 'rollback-container' });
    const soft = makeBlocker({ reason: 'skip-tag' });
    const result = getSoftBlockers(makeEligibility({ blockers: [hard, soft] }));
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('skip-tag');
  });

  it('respects explicit severity over map', () => {
    const demoted = makeBlocker({ reason: 'security-scan-blocked', severity: 'soft' });
    const result = getSoftBlockers(makeEligibility({ blockers: [demoted] }));
    expect(result).toHaveLength(1);
  });
});

describe('hasHardBlocker', () => {
  it('returns false when eligibility is undefined', () => {
    expect(hasHardBlocker(undefined)).toBe(false);
  });

  it('returns false when blockers is empty', () => {
    expect(hasHardBlocker(makeEligibility())).toBe(false);
  });

  it('returns false when there are only soft blockers', () => {
    const soft = makeBlocker({ reason: 'snoozed' });
    expect(hasHardBlocker(makeEligibility({ blockers: [soft] }))).toBe(false);
  });

  it('returns true when at least one hard blocker exists', () => {
    const hard = makeBlocker({ reason: 'agent-mismatch' });
    const soft = makeBlocker({ reason: 'snoozed' });
    expect(hasHardBlocker(makeEligibility({ blockers: [hard, soft] }))).toBe(true);
  });
});

describe('hasSoftBlocker', () => {
  it('returns false when eligibility is undefined', () => {
    expect(hasSoftBlocker(undefined)).toBe(false);
  });

  it('returns false when blockers is empty', () => {
    expect(hasSoftBlocker(makeEligibility())).toBe(false);
  });

  it('returns false when there are only hard blockers', () => {
    const hard = makeBlocker({ reason: 'no-update-trigger-configured' });
    expect(hasSoftBlocker(makeEligibility({ blockers: [hard] }))).toBe(false);
  });

  it('returns true when at least one soft blocker exists', () => {
    const hard = makeBlocker({ reason: 'rollback-container' });
    const soft = makeBlocker({ reason: 'maturity-not-reached' });
    expect(hasSoftBlocker(makeEligibility({ blockers: [hard, soft] }))).toBe(true);
  });
});

describe('getPrimaryHardBlocker', () => {
  it('returns undefined when eligibility is undefined', () => {
    expect(getPrimaryHardBlocker(undefined)).toBeUndefined();
  });

  it('returns undefined when blockers is empty', () => {
    expect(getPrimaryHardBlocker(makeEligibility())).toBeUndefined();
  });

  it('returns undefined when there are only soft blockers', () => {
    const soft = makeBlocker({ reason: 'skip-digest' });
    expect(getPrimaryHardBlocker(makeEligibility({ blockers: [soft] }))).toBeUndefined();
  });

  it('returns the first hard blocker in array order', () => {
    const first = makeBlocker({ reason: 'active-operation' });
    const second = makeBlocker({ reason: 'security-scan-blocked' });
    const soft = makeBlocker({ reason: 'snoozed' });
    const result = getPrimaryHardBlocker(makeEligibility({ blockers: [soft, first, second] }));
    expect(result?.reason).toBe('active-operation');
  });
});

describe('getPrimarySoftBlocker', () => {
  it('returns undefined when eligibility is undefined', () => {
    expect(getPrimarySoftBlocker(undefined)).toBeUndefined();
  });

  it('returns undefined when blockers is empty', () => {
    expect(getPrimarySoftBlocker(makeEligibility())).toBeUndefined();
  });

  it('returns undefined when there are only hard blockers', () => {
    const hard = makeBlocker({ reason: 'no-update-available' });
    expect(getPrimarySoftBlocker(makeEligibility({ blockers: [hard] }))).toBeUndefined();
  });

  it('returns the first soft blocker in array order', () => {
    const hard = makeBlocker({ reason: 'rollback-container' });
    const first = makeBlocker({ reason: 'threshold-not-reached' });
    const second = makeBlocker({ reason: 'trigger-excluded' });
    const result = getPrimarySoftBlocker(makeEligibility({ blockers: [hard, first, second] }));
    expect(result?.reason).toBe('threshold-not-reached');
  });
});
