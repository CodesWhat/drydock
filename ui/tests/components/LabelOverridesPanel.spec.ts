import { flushPromises, mount } from '@vue/test-utils';
import LabelOverridesPanel from '@/components/LabelOverridesPanel.vue';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import {
  getLabelOverrides,
  type LabelOverrideFieldState,
  LabelOverrideHttpError,
  type LabelOverrideSnapshot,
  patchLabelOverrides,
  resetLabelOverrides,
} from '@/services/label-override';
import type { LabelOwnedField, LabelOwnedSource } from '@/types/container';

vi.mock('@/services/label-override', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/label-override')>()),
  getLabelOverrides: vi.fn(),
  patchLabelOverrides: vi.fn(),
  resetLabelOverrides: vi.fn(),
}));

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
    scope: { kind: 'container', agent: null, watcher: 'local', name: 'web', appliesTo: [] },
    overrideId: null,
    revision: 0,
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
  declared: LabelOverrideFieldState['declared'] = { value: 'web', source: 'default' },
  label: string | null = null,
): Partial<LabelOverrideFieldState> => ({
  label,
  declared,
  override: { value, updatedAt: '2026-10-07T00:00:00.000Z', updatedBy: 'user:scott' },
  effective: { value, source: 'override' },
});

const withOverride = (overrides: Partial<LabelOverrideSnapshot> = {}) =>
  snapshot(
    { displayName: overridden('TV', { value: 'Sonarr', source: 'label' }, 'Sonarr') },
    {
      overrideId: 'o1',
      revision: 3,
      ...overrides,
    },
  );

const write = (current: LabelOverrideSnapshot, changed: LabelOwnedField[] = ['displayName']) => ({
  ...current,
  changed,
});

const tid = (id: string) => `[data-testid="label-overrides-${id}"]`;
const row = (field: string) => `[data-testid="label-override-row-${field}"]`;

const ContainerIconStub = {
  props: ['icon', 'size'],
  template: '<span data-testid="icon-stub" :data-icon="icon" />',
};

async function mountPanel(containerId = 'c1') {
  const wrapper = mount(LabelOverridesPanel, {
    props: { containerId },
    global: { stubs: { ContainerIcon: ContainerIconStub } },
  });
  await flushPromises();
  return wrapper;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(getLabelOverrides).mockReset().mockResolvedValue(snapshot());
  vi.mocked(patchLabelOverrides).mockReset();
  vi.mocked(resetLabelOverrides).mockReset();
  useConfirmDialog().dismiss();
});

describe('LabelOverridesPanel states', () => {
  it('shows a loading line, then the panel', async () => {
    const pending = deferred<LabelOverrideSnapshot>();
    vi.mocked(getLabelOverrides).mockReturnValueOnce(pending.promise);
    const wrapper = mount(LabelOverridesPanel, { props: { containerId: 'c1' } });
    expect(wrapper.find(tid('loading')).exists()).toBe(true);
    pending.resolve(snapshot());
    await flushPromises();
    expect(wrapper.find(tid('loading')).exists()).toBe(false);
    expect(wrapper.text()).toContain('Label overrides');
    expect(wrapper.text()).toContain('It never edits Compose files or recreates the container.');
  });

  it('shows a load error with a retry that loads again', async () => {
    vi.mocked(getLabelOverrides).mockRejectedValueOnce(new Error('down'));
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('error')).text()).toContain('down');
    expect(wrapper.find(row('displayName')).exists()).toBe(false);
    await wrapper.find(tid('retry')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error')).exists()).toBe(false);
    expect(wrapper.find(row('displayName')).exists()).toBe(true);
  });

  it('shows what the API says when the container is not overridable', async () => {
    vi.mocked(getLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'The container has no label override scope'),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('unavailable')).text()).toContain(
      'Label overrides are not available for this container.',
    );
    expect(wrapper.find(tid('unavailable')).text()).toContain(
      'The container has no label override scope',
    );
    expect(wrapper.find(row('displayName')).exists()).toBe(false);
    expect(wrapper.find(tid('reset-all')).exists()).toBe(false);
  });

  it('says so when nothing is overridden', async () => {
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('empty')).exists()).toBe(true);
    expect(wrapper.find(tid('reset-all')).exists()).toBe(false);
  });

  it('is read only for a rollback container', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      withOverride({ readOnlyReason: 'rollback-container' }),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('read-only')).text()).toContain('temporary rollback container');
    expect(wrapper.find(tid('edit-displayName')).exists()).toBe(false);
    expect(wrapper.find(tid('reset-displayName')).exists()).toBe(false);
    expect(wrapper.find(tid('reset-all')).exists()).toBe(false);
    expect(wrapper.find(row('displayName')).text()).toContain('TV');
  });
});

describe('LabelOverridesPanel scope', () => {
  it.each([
    [
      { kind: 'container', agent: null, name: 'web', appliesTo: [] },
      'container web, watcher local.',
    ],
    [
      { kind: 'container', agent: 'nas', name: 'web', appliesTo: [] },
      'container web on agent nas, watcher local.',
    ],
    [
      {
        kind: 'compose-service',
        agent: null,
        name: 'media/sonarr',
        appliesTo: [{ id: 'a', name: 'a' }],
      },
      'Compose service media/sonarr, 1 container, watcher local.',
    ],
    [
      {
        kind: 'compose-service',
        agent: null,
        name: 'media/sonarr',
        appliesTo: [
          { id: 'a', name: 'a' },
          { id: 'b', name: 'b' },
        ],
      },
      'Compose service media/sonarr, 2 containers, watcher local.',
    ],
    [
      {
        kind: 'compose-service',
        agent: 'nas',
        name: 'media/sonarr',
        appliesTo: [
          { id: 'a', name: 'a' },
          { id: 'b', name: 'b' },
        ],
      },
      'Compose service media/sonarr, 2 containers, agent nas, watcher local.',
    ],
  ])('states the scope for %j', async (scope, expected) => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({}, { scope: { watcher: 'local', ...scope } as LabelOverrideSnapshot['scope'] }),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('scope')).text()).toContain(expected);
  });
});

describe('LabelOverridesPanel rows', () => {
  it('lists the nine fields in four groups with their label keys', async () => {
    const wrapper = await mountPanel();
    for (const field of FIELDS) {
      expect(wrapper.find(row(field)).exists()).toBe(true);
      expect(wrapper.find(row(field)).text()).toContain(`dd.${field}`);
    }
    const text = wrapper.text();
    for (const heading of ['Display', 'Dependencies', 'Notification routing', 'Action routing']) {
      expect(text).toContain(heading);
    }
    expect(wrapper.find(row('displayName')).text()).toContain('Display name');
    expect(wrapper.find(row('actionTriggerAuto')).text()).toContain('Action auto');
  });

  it.each([
    ['override', 'Override'],
    ['label', 'Label'],
    ['compose', 'Compose'],
    ['watcher', 'Watcher config'],
    ['default', 'Default'],
    ['unset', 'Not set'],
  ] as [LabelOwnedSource, string][])('badges a %s source', async (source, text) => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({ dependsOn: { effective: { value: ['db'], source } } }),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('source-dependsOn')).text()).toBe(text);
  });

  it('shows the values of the dependency and routing fields', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({
        dependsOn: { effective: { value: ['db', 'cache'], source: 'label' } },
        dependsOnAction: { effective: { value: 'restart', source: 'label' } },
        notificationTriggerInclude: { effective: { value: [], source: 'override' } },
        actionTriggerAuto: { effective: { value: ['docker.local:minor'], source: 'watcher' } },
      }),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(row('dependsOn')).text()).toContain('db');
    expect(wrapper.find(row('dependsOn')).text()).toContain('cache');
    expect(wrapper.find(row('dependsOnAction')).text()).toContain('restart');
    expect(wrapper.find(row('notificationTriggerInclude')).text()).toContain('None');
    expect(wrapper.find(row('actionTriggerAuto')).text()).toContain('docker.local:minor');
    expect(wrapper.find(row('notificationTriggerExclude')).text()).toContain('Not set');
    for (const field of FIELDS) {
      expect(wrapper.find(tid(`edit-${field}`)).exists()).toBe(true);
    }
  });

  it('shows the label value and a reset with a hint on an overridden row', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('empty')).exists()).toBe(false);
    expect(wrapper.find(row('displayName')).text()).toContain('TV');
    expect(wrapper.find(tid('label-value-displayName')).text()).toBe('Label value: Sonarr');
    expect(wrapper.find(tid('reset-displayName')).attributes('title')).toBe('Reverts to: Sonarr');
    expect(wrapper.find(tid('reset-displayName')).text()).toBe('Reset to label');
    expect(wrapper.find(tid('reset-displayIcon')).exists()).toBe(false);
    expect(wrapper.find(tid('reset-all')).exists()).toBe(true);
  });

  it('says there is no label, and hints at the value it reverts to', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({
        displayName: overridden('TV', { value: 'web', source: 'default' }, null),
        displayIcon: overridden('sh:sonarr', { value: null, source: 'unset' }, null),
        notificationTriggerInclude: overridden(['slack.ops'], { value: [], source: 'unset' }),
        actionTriggerExclude: overridden(['docker.local'], {
          value: ['a', 'b'],
          source: 'label',
        }),
      }),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('label-value-displayName')).text()).toBe('No label');
    expect(wrapper.find(tid('reset-displayName')).attributes('title')).toBe('Reverts to: web');
    expect(wrapper.find(tid('reset-displayIcon')).attributes('title')).toBe('Reverts to: Not set');
    expect(wrapper.find(tid('reset-notificationTriggerInclude')).attributes('title')).toBe(
      'Reverts to: None',
    );
    expect(wrapper.find(tid('reset-actionTriggerExclude')).attributes('title')).toBe(
      'Reverts to: a, b',
    );
  });

  it('previews a slug icon and shows any other icon value as text only', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({ displayIcon: { effective: { value: 'hl:sonarr', source: 'label' } } }),
    );
    let wrapper = await mountPanel();
    expect(wrapper.find(tid('icon-preview-displayIcon')).exists()).toBe(true);
    expect(wrapper.find('[data-testid="icon-stub"]').attributes('data-icon')).toBe('hl-sonarr');
    expect(wrapper.find(row('displayIcon')).text()).toContain('hl:sonarr');

    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({
        displayIcon: { effective: { value: 'https://evil.example/x.png', source: 'label' } },
      }),
    );
    wrapper = await mountPanel();
    expect(wrapper.find('[data-testid="icon-stub"]').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find(row('displayIcon')).text()).toContain('https://evil.example/x.png');
  });

  it('renders warnings and unreadable stored fields', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot(
        {},
        {
          warnings: [
            {
              field: 'notificationTriggerInclude',
              code: 'stale-trigger-reference',
              reference: 'slack.old',
            },
            { field: 'dependsOn', code: 'unresolved-dependency', reference: 'db' },
            { field: 'dependsOn', code: 'cross-host-dependency', reference: 'cache' },
            { field: 'actionTriggerAuto', code: 'trigger-agent-mismatch', reference: 'docker.x' },
            { field: 'actionTriggerAuto', code: 'auto-inert', reference: 'docker.y' },
            { field: 'dependsOn', code: 'something-new' },
          ],
          invalidStoredOverride: [{ field: 'displayIcon', reason: 'bad' }],
        },
      ),
    );
    const wrapper = await mountPanel();
    const warnings = wrapper.find(tid('warnings')).text();
    expect(warnings).toContain(
      'Notification include: slack.old no longer matches a registered trigger.',
    );
    expect(warnings).toContain('Depends on: db is not a container Drydock knows yet.');
    expect(warnings).toContain('Depends on: cache only exists on another host.');
    expect(warnings).toContain('Action auto: docker.x only matches triggers on another agent.');
    expect(warnings).toContain('Action auto: docker.y matches no trigger that runs automatically.');
    expect(warnings).toContain('Depends on: something-new');
    expect(wrapper.find(tid('invalid-stored')).text()).toContain('displayIcon');
  });

  it('names an unknown field as sent and tolerates a warning with no reference', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({}, { warnings: [{ field: 'mystery', code: 'unresolved-dependency' }] }),
    );
    const wrapper = await mountPanel();
    expect(wrapper.find(tid('warnings')).text()).toContain('mystery:  is not a container');
  });
});

describe('LabelOverridesPanel display name editing', () => {
  async function openName(current = snapshot()) {
    vi.mocked(getLabelOverrides).mockResolvedValue(current);
    const wrapper = await mountPanel();
    await wrapper.find(tid('edit-displayName')).trigger('click');
    return wrapper;
  }

  it('seeds the draft with the effective value and saves a trimmed name', async () => {
    const wrapper = await openName(
      snapshot({ displayName: { effective: { value: 'web', source: 'default' } } }),
    );
    const input = wrapper.find(tid('name-input'));
    expect((input.element as HTMLInputElement).value).toBe('web');
    expect(input.attributes('maxlength')).toBe('128');
    expect(wrapper.text()).toContain(
      'Saving changes the value for everything in the scope shown above.',
    );
    await input.setValue('  TV  ');
    vi.mocked(patchLabelOverrides).mockResolvedValue(write(withOverride()));
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 0,
      overrideId: null,
      changes: [{ field: 'displayName', op: 'set', value: 'TV' }],
    });
    expect(wrapper.find(tid('name-input')).exists()).toBe(false);
    expect(wrapper.find(tid('status')).text()).toBe('Saved Display name.');
    expect(wrapper.find(row('displayName')).text()).toContain('TV');
  });

  it('starts blank when there is no value and keeps save off until valid', async () => {
    const wrapper = await openName();
    expect((wrapper.find(tid('name-input')).element as HTMLInputElement).value).toBe('');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    expect(wrapper.find(tid('error-displayName')).exists()).toBe(false);
    await wrapper.find(tid('name-input')).setValue('   ');
    expect(wrapper.find(tid('error-displayName')).text()).toBe('Enter a display name.');
    await wrapper.find(tid('name-input')).setValue('x'.repeat(129));
    expect(wrapper.find(tid('error-displayName')).text()).toBe('Use 128 characters or fewer.');
    await wrapper.find(tid('name-input')).setValue('a<b');
    expect(wrapper.find(tid('error-displayName')).text()).toContain('Remove control characters');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    await wrapper.find(tid('name-input')).setValue('ok');
    expect(wrapper.find(tid('error-displayName')).exists()).toBe(false);
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeUndefined();
  });

  it('cancels without sending anything and allows one editor at a time', async () => {
    const wrapper = await openName();
    expect(wrapper.find(tid('edit-displayIcon')).attributes('disabled')).toBeDefined();
    await wrapper.find(tid('cancel')).trigger('click');
    expect(wrapper.find(tid('name-input')).exists()).toBe(false);
    expect(patchLabelOverrides).not.toHaveBeenCalled();
    expect(wrapper.find(tid('edit-displayIcon')).attributes('disabled')).toBeUndefined();
  });

  it('shows a server validation message at the field and keeps the draft', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(400, 'Invalid label override request', {
        errors: [{ field: 'displayName', code: 'display-name-invalid-characters' }],
      }),
    );
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-displayName')).text()).toContain('Remove control characters');
    expect((wrapper.find(tid('name-input')).element as HTMLInputElement).value).toBe('ok');
    await wrapper.find(tid('name-input')).setValue('ok2');
    expect(wrapper.find(tid('error-displayName')).exists()).toBe(false);
  });

  it('falls back to a generic message for a code it has no text for', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(400, 'Invalid', {
        errors: [{ field: 'displayName', code: 'never-heard-of-it' }],
      }),
    );
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-displayName')).text()).toBe('The server rejected this change.');
  });

  it('keeps the draft on a stale revision, blocks saving and reloads on request', async () => {
    const wrapper = await openName(withOverride());
    await wrapper.find(tid('name-input')).setValue('Mine');
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'stale', { snapshot: withOverride({ revision: 9 }) }),
    );
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).text()).toContain('changed somewhere else');
    expect((wrapper.find(tid('name-input')).element as HTMLInputElement).value).toBe('Mine');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
    expect(wrapper.find(tid('reset-all')).attributes('disabled')).toBeDefined();
    expect(patchLabelOverrides).toHaveBeenCalledTimes(1);
    expect(getLabelOverrides).toHaveBeenCalledTimes(1);

    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride({ revision: 9 }));
    await wrapper.find(tid('reload')).trigger('click');
    await flushPromises();
    expect(getLabelOverrides).toHaveBeenCalledTimes(2);
    expect(wrapper.find(tid('conflict')).exists()).toBe(false);
    expect((wrapper.find(tid('name-input')).element as HTMLInputElement).value).toBe('Mine');
    vi.mocked(patchLabelOverrides).mockResolvedValue(write(withOverride({ revision: 10 })));
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(vi.mocked(patchLabelOverrides).mock.calls[1][1]).toMatchObject({ revision: 9 });
  });

  it('asks for a reload when the outcome is unknown', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(new Error('offline'));
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).text()).toContain('could not confirm');
    expect(wrapper.find(tid('conflict')).text()).toContain('offline');
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
  });

  it('says the container is gone on a 404', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(new LabelOverrideHttpError(404, 'gone'));
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).text()).toContain('no longer exists');
    expect(wrapper.find(tid('reload')).exists()).toBe(true);
  });

  it('turns read only on a 403', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(new LabelOverrideHttpError(403, 'no'));
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('read-only')).text()).toContain('Admin access is required');
    expect(wrapper.find(tid('name-input')).exists()).toBe(false);
    expect(wrapper.find(tid('edit-displayName')).exists()).toBe(false);
  });

  it('switches to the unavailable view when the write says there is no scope', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'The container has no label override scope'),
    );
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('unavailable')).exists()).toBe(true);
    expect(wrapper.find(tid('name-input')).exists()).toBe(false);
  });

  it('shows the server message for a failure it has no special text for', async () => {
    const wrapper = await openName();
    await wrapper.find(tid('name-input')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(422, 'The dependencies would create a cycle', { cycle: ['a'] }),
    );
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('failure')).text()).toContain('The dependencies would create a cycle');
  });
});

describe('LabelOverridesPanel icon editing', () => {
  async function openIcon(current = snapshot()) {
    vi.mocked(getLabelOverrides).mockResolvedValue(current);
    const wrapper = await mountPanel();
    await wrapper.find(tid('edit-displayIcon')).trigger('click');
    return wrapper;
  }

  it('offers the three icon sources and saves provider:slug', async () => {
    const wrapper = await openIcon();
    const options = wrapper.findAll(`${tid('icon-provider')} option`).map((o) => o.text());
    expect(options).toEqual(['selfh.st', 'Homarr', 'Simple Icons']);
    expect(wrapper.find(tid('icon-preview')).exists()).toBe(false);
    await wrapper.find(tid('icon-provider')).setValue('si');
    await wrapper.find(tid('icon-slug')).setValue('github');
    expect(wrapper.find('[data-testid="icon-stub"]').attributes('data-icon')).toBe('si-github');
    vi.mocked(patchLabelOverrides).mockResolvedValue(write(snapshot(), ['displayIcon']));
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 0,
      overrideId: null,
      changes: [{ field: 'displayIcon', op: 'set', value: 'si:github' }],
    });
    expect(wrapper.find(tid('status')).text()).toBe('Saved Display icon.');
  });

  it('seeds provider and slug from a slug-form effective icon', async () => {
    const wrapper = await openIcon(
      snapshot({ displayIcon: { effective: { value: 'HL-sonarr', source: 'label' } } }),
    );
    expect((wrapper.find(tid('icon-provider')).element as HTMLSelectElement).value).toBe('hl');
    expect((wrapper.find(tid('icon-slug')).element as HTMLInputElement).value).toBe('sonarr');
  });

  it('starts empty for a URL or mdi icon', async () => {
    const wrapper = await openIcon(
      snapshot({ displayIcon: { effective: { value: 'https://x.test/a.png', source: 'label' } } }),
    );
    expect((wrapper.find(tid('icon-provider')).element as HTMLSelectElement).value).toBe('sh');
    expect((wrapper.find(tid('icon-slug')).element as HTMLInputElement).value).toBe('');
  });

  it('rejects a URL or other non-slug text before sending and never previews it', async () => {
    const wrapper = await openIcon();
    for (const bad of ['https://evil.example/a.png', 'a/b', '-x', 'sonarr ', 'x'.repeat(129)]) {
      await wrapper.find(tid('icon-slug')).setValue(bad);
      expect(wrapper.find(tid('error-displayIcon')).text()).toContain('Use letters, numbers');
      expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
      expect(wrapper.find('[data-testid="icon-stub"]').exists()).toBe(false);
    }
    expect(patchLabelOverrides).not.toHaveBeenCalled();
  });

  it('keeps save off while the name is blank, without an error', async () => {
    const wrapper = await openIcon();
    expect(wrapper.find(tid('error-displayIcon')).exists()).toBe(false);
    expect(wrapper.find(tid('save')).attributes('disabled')).toBeDefined();
  });

  it('shows a server validation message at the icon field', async () => {
    const wrapper = await openIcon();
    await wrapper.find(tid('icon-slug')).setValue('ok');
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(400, 'Invalid', {
        errors: [{ field: 'displayIcon', code: 'invalid-icon' }],
      }),
    );
    await wrapper.find(tid('save')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('error-displayIcon')).text()).toBe(
      'Use an icon source and a name, not a URL.',
    );
    await wrapper.find(tid('icon-provider')).setValue('hl');
    expect(wrapper.find(tid('error-displayIcon')).exists()).toBe(false);
  });
});

describe('LabelOverridesPanel reset', () => {
  it('resets one field through the API', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel();
    vi.mocked(patchLabelOverrides).mockResolvedValue(write(snapshot()));
    await wrapper.find(tid('reset-displayName')).trigger('click');
    await flushPromises();
    expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
      revision: 3,
      overrideId: 'o1',
      changes: [{ field: 'displayName', op: 'remove' }],
    });
    expect(wrapper.find(tid('status')).text()).toBe('Reset Display name to its label value.');
    expect(wrapper.find(tid('reset-displayName')).exists()).toBe(false);
  });

  it('shows a failed reset in the panel', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel();
    vi.mocked(patchLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'stale', { snapshot: withOverride({ revision: 4 }) }),
    );
    await wrapper.find(tid('reset-displayName')).trigger('click');
    await flushPromises();
    expect(wrapper.find(tid('conflict')).exists()).toBe(true);
    expect(wrapper.find(tid('reset-displayName')).attributes('disabled')).toBeDefined();
  });

  it('confirms before resetting everything, then resets through the API', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      withOverride({
        scope: {
          kind: 'compose-service',
          agent: null,
          watcher: 'local',
          name: 'media/sonarr',
          appliesTo: [],
        },
      }),
    );
    const wrapper = await mountPanel();
    await wrapper.find(tid('reset-all')).trigger('click');
    const { current } = useConfirmDialog();
    expect(current.value?.header).toBe('Reset all overrides');
    expect(current.value?.message).toContain('media/sonarr');
    expect(resetLabelOverrides).not.toHaveBeenCalled();
    vi.mocked(resetLabelOverrides).mockResolvedValue(
      write(snapshot(), ['displayName', 'displayIcon']),
    );
    await useConfirmDialog().accept();
    await flushPromises();
    expect(resetLabelOverrides).toHaveBeenCalledWith('c1', 3, 'o1');
    expect(wrapper.find(tid('status')).text()).toBe('Reset 2 overrides to their label values.');
    expect(wrapper.find(tid('reset-all')).exists()).toBe(false);
  });

  it('pluralizes a single reset and handles an empty one', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel();
    await wrapper.find(tid('reset-all')).trigger('click');
    vi.mocked(resetLabelOverrides).mockResolvedValue(write(snapshot(), ['displayName']));
    await useConfirmDialog().accept();
    await flushPromises();
    expect(wrapper.find(tid('status')).text()).toBe('Reset 1 override to its label value.');

    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const other = await mountPanel();
    await other.find(tid('reset-all')).trigger('click');
    vi.mocked(resetLabelOverrides).mockResolvedValue(write(snapshot(), []));
    await useConfirmDialog().accept();
    await flushPromises();
    expect(other.find(tid('status')).text()).toBe('Nothing was overridden.');
  });

  it('does not reset another container when the selection moved before confirming', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel('c1');
    await wrapper.find(tid('reset-all')).trigger('click');
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride({ containerId: 'c2' }));
    await wrapper.setProps({ containerId: 'c2' });
    await flushPromises();
    await useConfirmDialog().accept();
    await flushPromises();
    expect(resetLabelOverrides).not.toHaveBeenCalled();
  });

  it('leaves everything alone when the confirmation is rejected', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel();
    await wrapper.find(tid('reset-all')).trigger('click');
    useConfirmDialog().reject();
    expect(resetLabelOverrides).not.toHaveBeenCalled();
  });

  it('shows a failed reset all', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel();
    await wrapper.find(tid('reset-all')).trigger('click');
    vi.mocked(resetLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'stale', { snapshot: withOverride({ revision: 4 }) }),
    );
    await useConfirmDialog().accept();
    await flushPromises();
    expect(wrapper.find(tid('conflict')).exists()).toBe(true);
  });
});

describe('LabelOverridesPanel container switching', () => {
  it('reloads for the new container and drops the open editor and messages', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(withOverride());
    const wrapper = await mountPanel('c1');
    await wrapper.find(tid('edit-displayName')).trigger('click');
    vi.mocked(getLabelOverrides).mockResolvedValue(snapshot({}, { containerId: 'c2' }));
    await wrapper.setProps({ containerId: 'c2' });
    await flushPromises();
    expect(getLabelOverrides).toHaveBeenLastCalledWith('c2');
    expect(wrapper.find(tid('name-input')).exists()).toBe(false);
    expect(wrapper.find(tid('empty')).exists()).toBe(true);
  });

  it('discards a save that finishes after the selection moved', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(snapshot());
    const wrapper = await mountPanel('c1');
    await wrapper.find(tid('edit-displayName')).trigger('click');
    await wrapper.find(tid('name-input')).setValue('TV');
    const slow = deferred<ReturnType<typeof write>>();
    vi.mocked(patchLabelOverrides).mockReturnValue(slow.promise);
    await wrapper.find(tid('save')).trigger('click');
    vi.mocked(getLabelOverrides).mockResolvedValue(snapshot({}, { containerId: 'c2' }));
    await wrapper.setProps({ containerId: 'c2' });
    await flushPromises();
    slow.resolve(write(withOverride()));
    await flushPromises();
    expect(wrapper.find(tid('status')).exists()).toBe(false);
    expect(wrapper.find(tid('empty')).exists()).toBe(true);
  });
});
