import { ref } from 'vue';
import { i18n } from '@/boot/i18n';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { resetDependencyGraphState, useDependencyGraph } from '@/composables/useDependencyGraph';
import { updateContainerPolicy } from '@/services/container';
import type { UpdateMode } from '@/services/settings';
import type { Container } from '@/types/container';
import { mapApiContainer } from '@/utils/container-mapper';
import { useFleetBulkActions } from '@/views/containers/useFleetBulkActions';

vi.mock('@/services/container', () => ({ updateContainerPolicy: vi.fn() }));

function row(id: string, overrides: Partial<Container> = {}): Container {
  return {
    ...mapApiContainer({ id, name: id, image: { name: 'nginx', tag: { value: '1.0.0' } } }),
    newTag: '1.0.1',
    updateKind: 'patch',
    ...overrides,
  };
}

function harness(rows: Container[] = [row('one'), row('two', { agent: 'edge' })]) {
  const input = {
    containers: ref(rows),
    scope: ref(rows),
    containerActionsEnabled: ref(true),
    busy: ref(false),
    updateMode: ref<UpdateMode>('manual'),
    isContainerRowLocked: (c: Container) => c.id === 'locked',
    isContainerUpdateInProgress: (c: Container) => c.id === 'updating',
    isContainerUpdateQueued: (c: Container) => c.id === 'queued',
    groupKeyForContainer: () => undefined,
    confirmBulkUpdate: vi.fn(),
    loadContainers: vi.fn().mockResolvedValue(undefined),
    t: i18n.global.t,
  };
  return { input, actions: useFleetBulkActions(input), confirm: useConfirmDialog() };
}

describe('useFleetBulkActions', () => {
  it.each([0, 1, 2, 7])('pluralizes English fleet counts for %s', (count) => {
    expect(i18n.global.t('containerComponents.fleetBulk.days', { count })).toBe(
      `${count} ${count === 1 ? 'day' : 'days'}`,
    );
    expect(i18n.global.t('containerComponents.fleetBulk.patchCount', { count })).toBe(
      `${count} patch ${count === 1 ? 'candidate' : 'candidates'}`,
    );
    expect(i18n.global.t('containerComponents.fleetBulk.snoozeConfirm', { count })).toBe(
      `Snooze ${count} patch ${count === 1 ? 'candidate' : 'candidates'}?`,
    );
  });

  beforeEach(() => {
    vi.mocked(updateContainerPolicy).mockReset().mockResolvedValue({});
    useConfirmDialog().dismiss();
    resetDependencyGraphState();
  });
  afterEach(() => useConfirmDialog().dismiss());

  it('plans every scoped live row, reporting blocked rows and explicit hidden parents', () => {
    const child = row('child');
    const parent = row('parent');
    const { input, actions } = harness([
      child,
      parent,
      row('blocked', { bouncer: 'blocked' }),
      row('hard', {
        updateEligibility: {
          eligible: false,
          blockers: [{ severity: 'hard', reason: 'x', message: 'hard stop' }],
        } as any,
      }),
      row('soft', {
        updateEligibility: {
          eligible: false,
          blockers: [{ severity: 'soft', reason: 'x', message: 'warning' }],
        } as any,
      }),
      row('none', { newTag: null }),
      row('locked'),
      row('updating'),
      row('queued'),
    ]);
    input.scope.value = input.containers.value.filter((c) => c.id !== 'parent');
    useDependencyGraph().graph.value = {
      nodes: [],
      edges: [{ from: 'child', to: 'parent' }],
      cycles: [],
    } as any;
    actions.updateAll();
    const plan = input.confirmBulkUpdate.mock.calls[0]![0];
    expect(plan.dispatch.map((c: Container) => c.id)).toEqual(['child', 'soft']);
    expect(plan.blocked.map((c: Container) => c.id)).toEqual(['blocked', 'hard']);
    expect(plan.skipped.map((c: Container) => c.id)).toEqual([
      'none',
      'locked',
      'updating',
      'queued',
    ]);
    expect(plan.staleParents).toEqual([{ id: 'parent', name: 'parent' }]);
    expect(plan.softOverrides[0].reason).toBe('warning');
    input.updateMode.value = 'notify';
    expect(actions.canUpdate.value).toBe(false);
    expect(actions.canSnooze.value).toBe(true);
  });

  it('deduplicates patch candidates and excludes minor, digest, absent and in-flight candidates', () => {
    const first = row('same', { name: 'web', agent: 'Local' });
    const { actions } = harness([
      first,
      first,
      row('local', { name: 'web' }),
      row('minor', { updateKind: 'minor' }),
      row('digest', { updateKind: 'digest' }),
      row('none', { newTag: null }),
      row('locked'),
      row('updating'),
      row('queued'),
    ]);
    expect(actions.patchCount.value).toBe(2);
    actions.snoozeAllPatch();
    expect(useConfirmDialog().current.value?.message).toContain('web (Local; same)');
    expect(useConfirmDialog().current.value?.message).toContain('web (Local watchers; local)');
  });

  it('makes no requests when empty, disabled, busy, invalid or cancelled', () => {
    const { input, actions, confirm } = harness([]);
    actions.updateAll();
    actions.snoozeAllPatch();
    input.scope.value = [row('one')];
    input.containerActionsEnabled.value = false;
    actions.updateAll();
    actions.snoozeAllPatch();
    input.containerActionsEnabled.value = true;
    input.busy.value = true;
    actions.updateAll();
    actions.snoozeAllPatch();
    input.busy.value = false;
    actions.duration.value = 'date';
    for (const date of ['invalid', '2027-02-29', '2027-04-31']) {
      actions.date.value = date;
      actions.snoozeAllPatch();
      expect(confirm.visible.value).toBe(false);
      expect(updateContainerPolicy).not.toHaveBeenCalled();
      expect(input.loadContainers).not.toHaveBeenCalled();
    }
    actions.duration.value = '1';
    actions.snoozeAllPatch();
    expect(confirm.visible.value).toBe(true);
    expect(actions.canUpdate.value).toBe(false);
    confirm.reject();
    expect(updateContainerPolicy).not.toHaveBeenCalled();
    expect(input.confirmBulkUpdate).not.toHaveBeenCalled();
  });

  it('freezes date and ids, preserves partial failures, and reports refresh separately', async () => {
    const { input, actions, confirm } = harness();
    actions.duration.value = 'date';
    actions.date.value = '2099-04-14';
    actions.snoozeAllPatch();
    actions.date.value = '2099-05-15';
    input.scope.value = [row('unconfirmed')];
    vi.mocked(updateContainerPolicy).mockRejectedValueOnce(new Error('gone'));
    input.loadContainers.mockRejectedValueOnce(new Error('refresh'));
    await confirm.accept();
    expect(updateContainerPolicy).toHaveBeenCalledTimes(2);
    expect(updateContainerPolicy).toHaveBeenLastCalledWith('two', 'snooze', {
      snoozeUntil: new Date('2099-04-14T23:59:59').toISOString(),
    });
    expect(actions.summary.value).toContain('Snoozed: 1. Failed: 1.');
    expect(actions.summary.value).toContain('one (Local watchers; one)');
    expect(actions.summary.value).toContain('refreshing the list failed');
    expect(actions.summaryWarning.value).toBe(true);
    expect(input.loadContainers).toHaveBeenCalledTimes(1);
  });

  it('guards repeated confirmations and stays busy through one final reload', async () => {
    const { input, actions, confirm } = harness();
    let finish!: () => void;
    input.loadContainers.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    actions.snoozeAllPatch();
    const callback = confirm.current.value!.accept!;
    const pending = confirm.accept();
    await vi.waitFor(() => expect(input.loadContainers).toHaveBeenCalledTimes(1));
    expect(actions.busy.value).toBe(true);
    expect(actions.canUpdate.value).toBe(false);
    actions.snoozeAllPatch();
    await callback();
    finish();
    await pending;
    expect(actions.busy.value).toBe(false);
    expect(actions.summaryWarning.value).toBe(false);
    expect(updateContainerPolicy).toHaveBeenCalledTimes(2);
  });

  it('reports disabled actions at acceptance without writing', async () => {
    const { input, actions, confirm } = harness();
    actions.snoozeAllPatch();
    input.containerActionsEnabled.value = false;
    await confirm.accept();
    expect(actions.summary.value).toContain('actions are disabled');
    expect(actions.summaryWarning.value).toBe(true);
    expect(updateContainerPolicy).not.toHaveBeenCalled();
  });

  it('reports an action that became busy before acceptance without writing', async () => {
    const { input, actions, confirm } = harness();
    actions.snoozeAllPatch();
    input.busy.value = true;
    await confirm.accept();
    expect(actions.summary.value).toContain('already running');
    expect(updateContainerPolicy).not.toHaveBeenCalled();
  });
});
