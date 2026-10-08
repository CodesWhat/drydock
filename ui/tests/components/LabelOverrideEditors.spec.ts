import { flushPromises, mount } from '@vue/test-utils';
import LabelOverridesPanel from '@/components/LabelOverridesPanel.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { getAllContainers } from '@/services/container';
import {
  getLabelOverrides,
  type LabelOverrideFieldState,
  LabelOverrideHttpError,
  type LabelOverrideSnapshot,
  patchLabelOverrides,
  resetLabelOverrides,
} from '@/services/label-override';
import { getAllTriggers } from '@/services/trigger';
import type { LabelOwnedField } from '@/types/container';

vi.mock('@/services/label-override', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/label-override')>()),
  getLabelOverrides: vi.fn(),
  patchLabelOverrides: vi.fn(),
  resetLabelOverrides: vi.fn(),
}));
vi.mock('@/services/container', () => ({ getAllContainers: vi.fn() }));
vi.mock('@/services/trigger', () => ({ getAllTriggers: vi.fn() }));

const FIELDS: LabelOwnedField[] = [
  'displayName',
  'displayIcon',
  'dependsOn',
  'dependsOnAction',
  'notificationTriggerInclude',
  'notificationTriggerExclude',
  'actionTriggerInclude',
  'actionTriggerExclude',
  'actionTriggerAuto',
];

function fieldState(
  field: LabelOwnedField,
  overrides: Partial<LabelOverrideFieldState> = {},
): LabelOverrideFieldState {
  return {
    labelKey: `dd.${field}`,
    label: null,
    declared: { value: null, source: 'unset' },
    override: null,
    effective: { value: null, source: 'unset' },
    ...overrides,
  };
}

function snapshot(
  fields: Partial<Record<LabelOwnedField, Partial<LabelOverrideFieldState>>> = {},
  overrides: Partial<LabelOverrideSnapshot> = {},
): LabelOverrideSnapshot {
  return {
    containerId: 'c1',
    scope: {
      kind: 'container',
      agent: null,
      watcher: 'local',
      name: 'web',
      appliesTo: [{ id: 'c1', name: 'web' }],
    },
    overrideId: 'o1',
    revision: 3,
    readOnlyReason: null,
    agentEnforcedActionRouting: false,
    fields: Object.fromEntries(
      FIELDS.map((field) => [field, fieldState(field, fields[field])]),
    ) as LabelOverrideSnapshot['fields'],
    warnings: [],
    ...overrides,
  };
}

const overridden = (
  value: string | string[],
  declared: LabelOverrideFieldState['declared'] = { value: null, source: 'unset' },
  label: string | null = null,
): Partial<LabelOverrideFieldState> => ({
  label,
  declared,
  override: { value, updatedAt: '2026-10-07T00:00:00.000Z', updatedBy: 'user:scott' },
  effective: { value, source: 'override' },
});

const declaredList = (value: string[]): Partial<LabelOverrideFieldState> => ({
  label: value.join(','),
  declared: { value, source: 'label' },
  effective: { value, source: 'label' },
});

const enforced = (fields: Parameters<typeof snapshot>[0] = {}) =>
  snapshot(fields, {
    agentEnforcedActionRouting: true,
    scope: {
      kind: 'container',
      agent: 'nas',
      watcher: 'local',
      name: 'web',
      appliesTo: [{ id: 'c1', name: 'web' }],
    },
  });

const written = (current: LabelOverrideSnapshot, changed: LabelOwnedField[]) => ({
  ...current,
  revision: current.revision + 1,
  changed,
});

const tid = (id: string) => `[data-testid="label-overrides-${id}"]`;
const row = (field: string) => `[data-testid="label-override-row-${field}"]`;
const rowTid = (field: string, id: string) => `${row(field)} ${tid(id)}`;

const trigger = (id: string, type: string) => ({ id, type, name: id, configuration: {} });

async function mountPanel(current: LabelOverrideSnapshot) {
  vi.mocked(getLabelOverrides).mockResolvedValue(current);
  const wrapper = mount(LabelOverridesPanel, { props: { containerId: 'c1' } });
  await flushPromises();
  return wrapper;
}

async function openEditor(wrapper: Awaited<ReturnType<typeof mountPanel>>, field: string) {
  await wrapper.find(tid(`edit-${field}`)).trigger('click');
  await flushPromises();
}

async function addEntry(
  wrapper: Awaited<ReturnType<typeof mountPanel>>,
  value: string,
  threshold?: string,
) {
  await wrapper.find(tid('list-input')).setValue(value);
  if (threshold) await wrapper.find(tid('list-threshold')).setValue(threshold);
  await wrapper.find(tid('list-add')).trigger('click');
}

const entries = (wrapper: Awaited<ReturnType<typeof mountPanel>>) =>
  wrapper.findAll(tid('list-entry')).map((entry) => entry.find('span').text());

beforeEach(() => {
  vi.mocked(getLabelOverrides).mockReset();
  vi.mocked(patchLabelOverrides).mockReset();
  vi.mocked(resetLabelOverrides).mockReset();
  vi.mocked(getAllContainers)
    .mockReset()
    .mockResolvedValue([
      { name: 'web', watcher: 'local' },
      { name: 'db', watcher: 'local' },
      { name: 'cache', watcher: 'local' },
      { name: 'elsewhere', watcher: 'other' },
    ]);
  vi.mocked(getAllTriggers)
    .mockReset()
    .mockResolvedValue([
      trigger('slack.team', 'slack'),
      trigger('smtp.mail', 'smtp'),
      trigger('docker.local', 'docker'),
      trigger('dockercompose.stack', 'dockercompose'),
    ]);
  useConfirmDialog().dismiss();
});

describe('dependency editor', () => {
  it('offers containers on the same watcher, not the scope itself, and saves the list', async () => {
    const current = snapshot();
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(written(current, ['dependsOn']));
    await openEditor(wrapper, 'dependsOn');
    expect(wrapper.findAll('datalist option').map((option) => option.attributes('value'))).toEqual([
      'cache',
      'db',
    ]);
    await addEntry(wrapper, 'db');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [{ field: 'dependsOn', op: 'set', value: ['db'] }],
    });
    expect(wrapper.find(tid('status')).text()).toContain('Saved Depends on');
    expect(wrapper.find(tid('list-input')).exists()).toBe(false);
  });

  it('allows a name that is not running and shows the warning the server sends back', async () => {
    const current = snapshot();
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue({
      ...written(current, ['dependsOn']),
      warnings: [{ field: 'dependsOn', code: 'unresolved-dependency', reference: 'ghost' }],
    });
    await openEditor(wrapper, 'dependsOn');
    await addEntry(wrapper, 'ghost');
    expect(entries(wrapper)).toEqual(['ghost']);
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('warnings')).text()).toContain(
      'ghost is not a container Drydock knows yet',
    );
  });

  it('blocks invalid names, duplicates and the container itself before sending', async () => {
    const wrapper = await mountPanel(snapshot());
    await openEditor(wrapper, 'dependsOn');
    await addEntry(wrapper, '-bad');
    expect(wrapper.find(tid('error-dependsOn')).text()).toContain('-bad');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="label-overrides-list-remove--bad"]').trigger('click');
    await addEntry(wrapper, 'web');
    expect(wrapper.find(tid('error-dependsOn')).text()).toContain("can't depend on itself");
    await wrapper.find('[data-testid="label-overrides-list-remove-web"]').trigger('click');
    await addEntry(wrapper, 'db');
    await addEntry(wrapper, 'db');
    expect(wrapper.find(tid('error-dependsOn')).text()).toContain('more than once');
    expect(patchLabelOverrides).not.toHaveBeenCalled();
  });

  it('saves an emptied list as an explicit none and says so', async () => {
    const current = snapshot({
      dependsOn: overridden(['db'], { value: ['cache'], source: 'label' }, 'cache'),
    });
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(written(current, ['dependsOn']));
    await openEditor(wrapper, 'dependsOn');
    expect(wrapper.find(tid('none-hint')).exists()).toBe(false);
    await wrapper.find('[data-testid="label-overrides-list-remove-db"]').trigger('click');
    expect(wrapper.find(tid('none-hint')).text()).toContain('none');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [{ field: 'dependsOn', op: 'set', value: [] }],
    });
  });

  it('tells no override apart from an override set to empty', async () => {
    const wrapper = await mountPanel(
      snapshot({
        dependsOn: overridden([], { value: ['cache'], source: 'label' }, 'cache'),
        notificationTriggerExclude: {},
      }),
    );
    expect(wrapper.find(row('dependsOn')).text()).toContain('None (override)');
    expect(wrapper.find(tid('source-dependsOn')).text()).toBe('Override');
    expect(wrapper.find(row('notificationTriggerExclude')).text()).toContain('Not set');
    expect(wrapper.find(row('notificationTriggerExclude')).text()).not.toContain('None (override)');
  });

  it('shows the cycle the server refuses and keeps the draft', async () => {
    const wrapper = await mountPanel(snapshot());
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(422, 'The dependencies would create a cycle', {
        cycle: ['cache', 'db', 'web'],
      }),
    );
    await openEditor(wrapper, 'dependsOn');
    await addEntry(wrapper, 'db');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('cycle')).text()).toContain('cache, db, web');
    expect(entries(wrapper)).toEqual(['db']);
    expect(wrapper.find(tid('failure')).exists()).toBe(false);
    await addEntry(wrapper, 'cache');
    expect(wrapper.find(tid('cycle')).exists()).toBe(false);
  });

  it('edits the dependency action from the allowed values', async () => {
    const current = snapshot({
      dependsOnAction: { effective: { value: 'update', source: 'default' } },
    });
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(written(current, ['dependsOnAction']));
    await openEditor(wrapper, 'dependsOnAction');
    const select = wrapper.find(tid('action-select'));
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'update',
      'restart',
    ]);
    await select.setValue('restart');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [{ field: 'dependsOnAction', op: 'set', value: 'restart' }],
    });
  });

  it('shows a server refusal of the dependency action at the field', async () => {
    const wrapper = await mountPanel(snapshot());
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(400, 'Invalid request', {
        errors: [{ field: 'dependsOnAction', code: 'invalid-action' }],
      }),
    );
    await openEditor(wrapper, 'dependsOnAction');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-dependsOnAction')).text()).toContain('Choose update or restart');
  });

  it('starts the action select on update when nothing is set', async () => {
    const wrapper = await mountPanel(snapshot());
    await openEditor(wrapper, 'dependsOnAction');
    expect((wrapper.find(tid('action-select')).element as HTMLSelectElement).value).toBe('update');
  });
});

describe('routing editors', () => {
  it('offers notification triggers for notification fields and action triggers for action fields', async () => {
    const wrapper = await mountPanel(snapshot());
    await openEditor(wrapper, 'notificationTriggerInclude');
    expect(wrapper.findAll('datalist option').map((o) => o.attributes('value'))).toEqual([
      'slack.team',
      'smtp.mail',
    ]);
    await wrapper.find(tid('cancel')).trigger('click');
    await openEditor(wrapper, 'actionTriggerExclude');
    expect(wrapper.findAll('datalist option').map((o) => o.attributes('value'))).toEqual([
      'docker.local',
      'dockercompose.stack',
    ]);
  });

  it('saves entries with the threshold suffix', async () => {
    const current = snapshot();
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(
      written(current, ['notificationTriggerInclude']),
    );
    await openEditor(wrapper, 'notificationTriggerInclude');
    await addEntry(wrapper, 'slack.team', 'minor');
    await addEntry(wrapper, 'smtp.mail');
    expect(entries(wrapper)).toEqual(['slack.team:minor', 'smtp.mail']);
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [
        {
          field: 'notificationTriggerInclude',
          op: 'set',
          value: ['slack.team:minor', 'smtp.mail'],
        },
      ],
    });
  });

  it('rejects an unknown trigger and a trigger of the wrong kind before sending', async () => {
    const wrapper = await mountPanel(snapshot());
    await openEditor(wrapper, 'actionTriggerInclude');
    await addEntry(wrapper, 'ghost.one');
    expect(wrapper.find(tid('error-actionTriggerInclude')).text()).toContain('ghost.one');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="label-overrides-list-remove-ghost.one"]').trigger('click');
    await addEntry(wrapper, 'slack.team');
    expect(wrapper.find(tid('error-actionTriggerInclude')).text()).toContain('Wrong kind');
    expect(patchLabelOverrides).not.toHaveBeenCalled();
  });

  it('shows the server message for an unknown trigger when the list could not be checked', async () => {
    vi.mocked(getAllTriggers).mockRejectedValue(new Error('down'));
    const wrapper = await mountPanel(snapshot());
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(400, 'Invalid request', {
        errors: [
          {
            field: 'actionTriggerInclude',
            code: 'unknown-trigger-reference',
            entries: ['ghost.one'],
          },
        ],
      }),
    );
    await openEditor(wrapper, 'actionTriggerInclude');
    await addEntry(wrapper, 'ghost.one');
    expect(wrapper.find(tid('error-actionTriggerInclude')).exists()).toBe(false);
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-actionTriggerInclude')).text()).toContain('ghost.one');
    expect(entries(wrapper)).toEqual(['ghost.one']);
  });

  it('warns when the change grants automatic execution', async () => {
    const wrapper = await mountPanel(snapshot({ actionTriggerAuto: overridden(['docker.local']) }));
    await openEditor(wrapper, 'actionTriggerAuto');
    expect(wrapper.find(tid('auto-warning')).exists()).toBe(false);
    await addEntry(wrapper, 'dockercompose.stack');
    expect(wrapper.find(tid('auto-warning')).text()).toContain('automatically');
    await wrapper
      .find('[data-testid="label-overrides-list-remove-dockercompose.stack"]')
      .trigger('click');
    expect(wrapper.find(tid('auto-warning')).exists()).toBe(false);
  });

  it('shows warnings returned on a routing save', async () => {
    const current = snapshot();
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue({
      ...written(current, ['actionTriggerAuto']),
      warnings: [{ field: 'actionTriggerAuto', code: 'auto-inert', reference: 'docker.local' }],
    });
    await openEditor(wrapper, 'actionTriggerAuto');
    await addEntry(wrapper, 'docker.local');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('warnings')).text()).toContain(
      'docker.local matches no trigger that runs automatically',
    );
  });
});

describe('restrict-only on an agent container', () => {
  it('says the agent enforces its labels', async () => {
    const wrapper = await mountPanel(enforced());
    expect(wrapper.find(tid('agent-note')).text()).toContain('agent nas');
    expect(wrapper.find(tid('agent-note')).text()).toContain('only narrow');
    const plain = await mountPanel(snapshot());
    expect(plain.find(tid('agent-note')).exists()).toBe(false);
  });

  it('keeps the declared exclusions fixed and only adds', async () => {
    const current = enforced({ actionTriggerExclude: declaredList(['docker.local']) });
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(written(current, ['actionTriggerExclude']));
    await openEditor(wrapper, 'actionTriggerExclude');
    expect(wrapper.find('[data-testid="label-overrides-list-remove-docker.local"]').exists()).toBe(
      false,
    );
    expect(wrapper.find(tid('agent-hint-actionTriggerExclude')).text()).toContain('only add');
    await addEntry(wrapper, 'dockercompose.stack');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [
        {
          field: 'actionTriggerExclude',
          op: 'set',
          value: ['docker.local', 'dockercompose.stack'],
        },
      ],
    });
  });

  it('puts declared exclusions first when an old override lacks them', async () => {
    const wrapper = await mountPanel(
      enforced({
        actionTriggerExclude: {
          ...overridden(['dockercompose.stack']),
          declared: { value: ['docker.local'], source: 'label' },
        },
      }),
    );
    await openEditor(wrapper, 'actionTriggerExclude');
    expect(entries(wrapper)).toEqual(['docker.local', 'dockercompose.stack']);
  });

  it('only offers the declared references for include and narrower thresholds', async () => {
    const current = enforced({
      actionTriggerInclude: declaredList(['docker.local:minor', 'dockercompose.stack']),
    });
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(written(current, ['actionTriggerInclude']));
    await openEditor(wrapper, 'actionTriggerInclude');
    expect(wrapper.findAll('datalist option').map((o) => o.attributes('value'))).toEqual([
      'docker.local',
      'dockercompose.stack',
    ]);
    await wrapper
      .find('[data-testid="label-overrides-list-remove-docker.local:minor"]')
      .trigger('click');
    await wrapper.find(tid('list-input')).setValue('docker.local');
    expect(
      wrapper.findAll(`${tid('list-threshold')} option`).map((o) => o.attributes('value')),
    ).toEqual(['minor']);
    await wrapper.find(tid('list-input')).setValue('slack.team');
    expect(wrapper.find(tid('list-add')).attributes('disabled')).toBeDefined();
    await wrapper.find(tid('list-input')).setValue('dockercompose.stack');
    expect(
      wrapper.findAll(`${tid('list-threshold')} option`).map((o) => o.attributes('value')),
    ).toHaveLength(12);
  });

  it('will not save an emptied include while the labels declare one', async () => {
    const wrapper = await mountPanel(
      enforced({ actionTriggerInclude: declaredList(['docker.local']) }),
    );
    await openEditor(wrapper, 'actionTriggerInclude');
    await wrapper.find('[data-testid="label-overrides-list-remove-docker.local"]').trigger('click');
    expect(wrapper.find(tid('error-actionTriggerInclude')).text()).toContain('would refuse');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
  });

  it('offers no edit for include or auto when the labels declare nothing to narrow', async () => {
    const wrapper = await mountPanel(enforced());
    expect(wrapper.find(tid('edit-actionTriggerInclude')).exists()).toBe(false);
    expect(wrapper.find(tid('edit-actionTriggerAuto')).exists()).toBe(false);
    expect(wrapper.find(row('actionTriggerInclude')).text()).toContain('nothing to narrow');
    expect(wrapper.find(tid('edit-actionTriggerExclude')).exists()).toBe(true);
    expect(wrapper.find(tid('edit-notificationTriggerInclude')).exists()).toBe(true);
  });

  it('renders the refusal when the server still says widening', async () => {
    const wrapper = await mountPanel(
      enforced({ actionTriggerExclude: declaredList(['docker.local']) }),
    );
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(400, 'Invalid request', {
        errors: [
          {
            field: 'actionTriggerExclude',
            code: 'agent-enforced-widening',
            entries: ['docker.local:all'],
          },
        ],
      }),
    );
    await openEditor(wrapper, 'actionTriggerExclude');
    await addEntry(wrapper, 'dockercompose.stack');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-actionTriggerExclude')).text()).toContain('docker.local:all');
    expect(entries(wrapper)).toEqual(['docker.local', 'dockercompose.stack']);
  });

  it('leaves notification routing unrestricted', async () => {
    const wrapper = await mountPanel(enforced());
    await openEditor(wrapper, 'notificationTriggerInclude');
    expect(wrapper.find(tid('agent-hint-notificationTriggerInclude')).exists()).toBe(false);
    await addEntry(wrapper, 'slack.team');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeUndefined();
  });
});

describe('stale revision and reset', () => {
  it('keeps the list draft on a stale revision and does not retry', async () => {
    const current = snapshot();
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'Stale', { snapshot: snapshot({}, { revision: 4 }) }),
    );
    await openEditor(wrapper, 'notificationTriggerExclude');
    await addEntry(wrapper, 'slack.team');
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).text()).toContain('Your draft is kept');
    expect(entries(wrapper)).toEqual(['slack.team']);
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    expect(patchLabelOverrides).toHaveBeenCalledTimes(1);
    vi.mocked(getLabelOverrides).mockResolvedValue(snapshot({}, { revision: 4 }));
    await wrapper.find(tid('reload')).trigger('click');
    await flushPromises();
    expect(entries(wrapper)).toEqual(['slack.team']);
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeUndefined();
  });

  it('resets one list field to its label with a remove change', async () => {
    const current = snapshot({
      actionTriggerInclude: overridden(
        ['docker.local'],
        { value: ['dockercompose.stack'], source: 'label' },
        'dockercompose.stack',
      ),
    });
    const wrapper = await mountPanel(current);
    vi.mocked(patchLabelOverrides).mockResolvedValue(written(current, ['actionTriggerInclude']));
    expect(
      wrapper.find(rowTid('actionTriggerInclude', 'label-value-actionTriggerInclude')).text(),
    ).toContain('Label value: dockercompose.stack');
    await wrapper.find(tid('reset-actionTriggerInclude')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [{ field: 'actionTriggerInclude', op: 'remove' }],
    });
  });
});
