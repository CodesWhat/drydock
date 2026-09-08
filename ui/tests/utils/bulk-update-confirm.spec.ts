import { BULK_UPDATE_I18N_KEYS, formatBulkUpdateConfirm } from '@/utils/bulk-update-confirm';
import type { BulkUpdatePlan } from '@/utils/bulk-update-plan';

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

function emptyPlan(overrides: Partial<BulkUpdatePlan> = {}): BulkUpdatePlan {
  return {
    dispatch: [],
    skipped: [],
    blocked: [],
    softOverrides: [],
    staleParents: [],
    agentCount: 0,
    stackCount: 0,
    ...overrides,
  };
}

describe('formatBulkUpdateConfirm', () => {
  it('is disabled with an empty accept label context when dispatch is empty', () => {
    const result = formatBulkUpdateConfirm(emptyPlan(), t);
    expect(result.disabled).toBe(true);
    expect(result.header).toBe('containerComponents.confirmDialogs.bulkUpdate.header:{"count":0}');
    expect(result.acceptLabel).toBe(
      'containerComponents.confirmDialogs.bulkUpdate.accept:{"count":0}',
    );
    expect(result.message).toBe('');
  });

  it('renders only the dispatch section for a plain plan and enables the dialog', () => {
    const plan = emptyPlan({
      dispatch: [
        { id: 'a', name: 'alpha' },
        { id: 'b', name: 'beta' },
      ],
    });
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.disabled).toBe(false);
    expect(result.message).toBe(
      [
        'containerComponents.confirmDialogs.bulkUpdate.dispatchHeading:{"count":2}',
        '• alpha',
        '• beta',
      ].join('\n'),
    );
    expect(result.acceptLabel).toBe(
      'containerComponents.confirmDialogs.bulkUpdate.accept:{"count":2}',
    );
  });

  it('appends the reason in parentheses for blocked bullets', () => {
    const plan = emptyPlan({
      blocked: [
        { id: 'a', name: 'alpha', reason: 'rollback in progress' },
        { id: 'b', name: 'beta' },
      ],
    });
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.message).toBe(
      [
        'containerComponents.confirmDialogs.bulkUpdate.blockedHeading:{"count":2}',
        '• alpha (rollback in progress)',
        '• beta',
      ].join('\n'),
    );
  });

  it('appends the reason in parentheses for softOverrides bullets', () => {
    const plan = emptyPlan({
      dispatch: [{ id: 'a', name: 'alpha' }],
      softOverrides: [{ id: 'a', name: 'alpha', reason: 'Snoozed until tomorrow' }],
    });
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.message).toContain(
      [
        'containerComponents.confirmDialogs.bulkUpdate.softOverridesHeading:{"count":1}',
        '• alpha (Snoozed until tomorrow)',
      ].join('\n'),
    );
  });

  it('appends the translated reason key in parentheses for skipped bullets', () => {
    const plan = emptyPlan({
      skipped: [
        { id: 'a', name: 'alpha', reason: 'containerComponents.selection.reasons.noUpdate' },
      ],
    });
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.message).toBe(
      [
        'containerComponents.confirmDialogs.bulkUpdate.skippedHeading:{"count":1}',
        '• alpha (containerComponents.selection.reasons.noUpdate)',
      ].join('\n'),
    );
  });

  it('renders a staleParents section and switches to the acceptWithParents label, counted by parents added (not the dispatch count)', () => {
    const plan = emptyPlan({
      dispatch: [
        { id: 'app', name: 'app' },
        { id: 'web', name: 'web' },
      ],
      staleParents: [{ id: 'db', name: 'database' }],
    });
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.message).toBe(
      [
        'containerComponents.confirmDialogs.bulkUpdate.dispatchHeading:{"count":2}',
        '• app',
        '• web',
        'containerComponents.confirmDialogs.bulkUpdate.staleParentsHeading:{"count":1}',
        '• database',
      ].join('\n'),
    );
    expect(result.acceptLabel).toBe(
      'containerComponents.confirmDialogs.bulkUpdate.acceptWithParents:{"count":1}',
    );
  });

  it('omits every section whose entry list is empty', () => {
    const plan = emptyPlan({ dispatch: [{ id: 'a', name: 'alpha' }] });
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.message).not.toContain('blockedHeading');
    expect(result.message).not.toContain('softOverridesHeading');
    expect(result.message).not.toContain('skippedHeading');
    expect(result.message).not.toContain('staleParentsHeading');
  });

  it('adds the agent-count informational line only when agentCount is greater than 1', () => {
    const single = formatBulkUpdateConfirm(
      emptyPlan({ dispatch: [{ id: 'a', name: 'alpha' }], agentCount: 1 }),
      t,
    );
    expect(single.message).not.toContain('agentCountInfo');

    const multiple = formatBulkUpdateConfirm(
      emptyPlan({ dispatch: [{ id: 'a', name: 'alpha' }], agentCount: 2 }),
      t,
    );
    expect(multiple.message).toContain(
      'containerComponents.confirmDialogs.bulkUpdate.agentCountInfo:{"count":2}',
    );
  });

  it('adds the stack-count informational line only when stackCount is greater than 1', () => {
    const single = formatBulkUpdateConfirm(
      emptyPlan({ dispatch: [{ id: 'a', name: 'alpha' }], stackCount: 1 }),
      t,
    );
    expect(single.message).not.toContain('stackCountInfo');

    const multiple = formatBulkUpdateConfirm(
      emptyPlan({ dispatch: [{ id: 'a', name: 'alpha' }], stackCount: 3 }),
      t,
    );
    expect(multiple.message).toContain(
      'containerComponents.confirmDialogs.bulkUpdate.stackCountInfo:{"count":3}',
    );
  });

  it('renders every section together in a full plan, joined by newlines, in dispatch/blocked/softOverrides/skipped/staleParents/agent/stack order', () => {
    const plan: BulkUpdatePlan = {
      dispatch: [
        { id: 'a', name: 'alpha' },
        { id: 'e', name: 'epsilon' },
      ],
      blocked: [{ id: 'b', name: 'beta', reason: 'hard blocked' }],
      softOverrides: [{ id: 'a', name: 'alpha', reason: 'soft blocked' }],
      skipped: [{ id: 'c', name: 'gamma', reason: 'skip reason' }],
      staleParents: [{ id: 'd', name: 'delta' }],
      agentCount: 2,
      stackCount: 2,
    };
    const result = formatBulkUpdateConfirm(plan, t);
    expect(result.message).toBe(
      [
        'containerComponents.confirmDialogs.bulkUpdate.dispatchHeading:{"count":2}',
        '• alpha',
        '• epsilon',
        'containerComponents.confirmDialogs.bulkUpdate.blockedHeading:{"count":1}',
        '• beta (hard blocked)',
        'containerComponents.confirmDialogs.bulkUpdate.softOverridesHeading:{"count":1}',
        '• alpha (soft blocked)',
        'containerComponents.confirmDialogs.bulkUpdate.skippedHeading:{"count":1}',
        '• gamma (skip reason)',
        'containerComponents.confirmDialogs.bulkUpdate.staleParentsHeading:{"count":1}',
        '• delta',
        'containerComponents.confirmDialogs.bulkUpdate.agentCountInfo:{"count":2}',
        'containerComponents.confirmDialogs.bulkUpdate.stackCountInfo:{"count":2}',
      ].join('\n'),
    );
    expect(result.acceptLabel).toBe(
      'containerComponents.confirmDialogs.bulkUpdate.acceptWithParents:{"count":1}',
    );
    expect(result.disabled).toBe(false);
  });
});

describe('BULK_UPDATE_I18N_KEYS', () => {
  it('lists every key this module and the plan reason keys depend on', () => {
    expect(BULK_UPDATE_I18N_KEYS).toEqual([
      'containerComponents.confirmDialogs.bulkUpdate.header',
      'containerComponents.confirmDialogs.bulkUpdate.accept',
      'containerComponents.confirmDialogs.bulkUpdate.acceptWithParents',
      'containerComponents.confirmDialogs.bulkUpdate.dispatchHeading',
      'containerComponents.confirmDialogs.bulkUpdate.blockedHeading',
      'containerComponents.confirmDialogs.bulkUpdate.softOverridesHeading',
      'containerComponents.confirmDialogs.bulkUpdate.skippedHeading',
      'containerComponents.confirmDialogs.bulkUpdate.staleParentsHeading',
      'containerComponents.confirmDialogs.bulkUpdate.agentCountInfo',
      'containerComponents.confirmDialogs.bulkUpdate.stackCountInfo',
      'containerComponents.selection.reasons.stale',
      'containerComponents.selection.reasons.inFlight',
      'containerComponents.selection.reasons.noUpdate',
    ]);
  });
});
