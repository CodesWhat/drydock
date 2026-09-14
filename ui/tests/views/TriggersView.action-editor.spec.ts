import { flushPromises } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import { resetPreferences } from '@/preferences/store';
import TriggersView from '@/views/TriggersView.vue';
import { actionOutcome, actionSnapshot } from '../helpers/action-editor';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));
describe('action policy editor integration', () => {
  beforeEach(() => resetPreferences());
  afterEach(() => vi.unstubAllGlobals());
  async function setup(
    type = 'docker',
    snapshot = actionSnapshot(type),
    intercept?: (path: string, options?: RequestInit) => Response | Promise<Response> | undefined,
  ) {
    const calls: Array<{ path: string; options?: RequestInit }> = [];
    const trigger = {
      id: `${type}.policy`,
      type,
      name: 'policy',
      agent: snapshot.actions[0].agent ?? null,
      configuration: { auto: true, order: -2.5, concurrency: 3, dryrun: true },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        calls.push({ path, options });
        const response = intercept?.(path, options);
        if (response) return response;
        if (path === '/api/v1/triggers')
          return Response.json({
            data: [trigger, { ...trigger, id: 'command.other', type: 'command', name: 'other' }],
            total: 2,
          });
        if (path.startsWith('/api/v1/triggers/')) return Response.json(trigger);
        if (path === '/api/v1/config/editor/actions')
          return Response.json(options?.method === 'PATCH' ? actionOutcome() : snapshot);
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    const wrapper = mountWithPlugins(TriggersView, { global: { stubs: dataViewStubs } });
    await flushPromises();
    await wrapper.get('.row-click-first').trigger('click');
    await flushPromises();
    return { wrapper, calls };
  }
  it.each(['docker', 'dockercompose', 'portainer', 'command'])(
    'edits %s policy with typed leaves without execution',
    async (type) => {
      const { wrapper, calls } = await setup(type);
      try {
        expect(calls).toHaveLength(2);
        await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
        await flushPromises();
        expect(wrapper.get<HTMLSelectElement>('[data-field="auto"]').element.value).toBe('all');
        expect(wrapper.get<HTMLInputElement>('[data-field="order"]').element.value).toBe('-2.5');
        expect(wrapper.get('[data-field="order"]').attributes('step')).toBe('any');
        expect(wrapper.get('[data-field="order"]').attributes('min')).toBeUndefined();
        expect(wrapper.get('[data-field="concurrency"]').attributes('min')).toBe('1');
        await wrapper.get('[data-field="auto"]').setValue('onauto');
        await wrapper.get('[data-field="order"]').setValue('-4.25');
        await wrapper.get('[data-field="concurrency"]').setValue('7');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const writes = calls.filter(({ options }) => options?.method === 'PATCH');
        expect(writes).toHaveLength(1);
        expect(JSON.parse(String(writes[0].options?.body))).toEqual({
          revision: 'initial',
          changes: [
            { path: ['Action', type, 'Policy', 'auto'], operation: 'set', value: 'onauto' },
            { path: ['Action', type, 'Policy', 'order'], operation: 'set', value: -4.25 },
            { path: ['Action', type, 'Policy', 'concurrency'], operation: 'set', value: 7 },
          ],
        });
        expect(calls).toHaveLength(5);
        expect(calls.every(({ path }) => !path.includes('/run'))).toBe(true);
        expect(wrapper.text()).toContain('Saved and applied');
      } finally {
        wrapper.unmount();
      }
    },
  );
  it.each(['', '0', '-1', '1.5'])(
    'does not turn invalid concurrency %j into zero or removal',
    async (value) => {
      const { wrapper, calls } = await setup();
      try {
        await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-field="concurrency"]').setValue(value);
        expect(wrapper.get('[data-field="concurrency"]').attributes('aria-invalid')).toBe('true');
        expect(
          wrapper.get('[data-testid="save-action-policy"]').attributes('disabled'),
        ).toBeDefined();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(calls).toHaveLength(3);
      } finally {
        wrapper.unmount();
      }
    },
  );
  it('keeps explicit removal separate from blank order and cancel never writes', async () => {
    const { wrapper, calls } = await setup();
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-field="order"]').setValue('');
      expect(
        wrapper.get('[data-testid="save-action-policy"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper.get('[data-reset="order"]').trigger('click');
      await wrapper.get('[data-testid="cancel-action-policy"]').trigger('click');
      expect(calls).toHaveLength(3);
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-reset="concurrency"]').trigger('click');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      const write = calls.find(({ options }) => options?.method === 'PATCH');
      expect(JSON.parse(String(write?.options?.body))).toEqual({
        revision: 'initial',
        changes: [{ path: ['Action', 'docker', 'Policy', 'concurrency'], operation: 'remove' }],
      });
    } finally {
      wrapper.unmount();
    }
  });
  it('keeps partial-save feedback through matching row refresh and locale change', async () => {
    let saved = false;
    const { wrapper, calls } = await setup('docker', actionSnapshot(), (path, options) => {
      if (options?.method === 'PATCH') {
        saved = true;
        return Response.json(actionOutcome({ reload: { applied: false, errors: [] } }));
      }
      if (saved && path === '/api/v1/triggers/docker/policy')
        return Response.json({
          id: 'docker.policy',
          type: 'docker',
          name: 'policy',
          agent: null,
          configuration: { order: -8, dryrun: true },
        });
    });
    const locale = i18n.global.locale.value;
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-field="order"]').setValue('-8');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toContain('operation reported problems');
      expect(wrapper.get<HTMLInputElement>('[data-field="order"]').element.value).toBe('-8');
      const rows = wrapper.findComponent(dataViewStubs.DataTable).props('rows');
      expect(rows[0].config.order).toBe(-8);
      expect(rows[1].config.order).toBe(-2.5);
      i18n.global.locale.value = 'fr';
      await flushPromises();
      expect(wrapper.get('[role="alert"]').text()).toBe(i18n.global.t('watcherEditor.notApplied'));
      expect(calls).toHaveLength(5);
    } finally {
      wrapper.unmount();
      i18n.global.locale.value = locale;
    }
  });
  it('renders read-only ownership without exposing references or guessing inheritance', async () => {
    const snapshot = actionSnapshot();
    snapshot.actions[0].fields.auto = {
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
      value: 'private-ref',
      effectiveValue: 'private-ref',
    };
    snapshot.actions[0].fields.order = {
      present: true,
      source: 'env',
      readOnlyReason: 'environment-owned',
      effectiveValue: -5,
    };
    snapshot.actions[0].fields.concurrency = {
      present: false,
      source: 'default',
      path: ['Action', 'Docker', 'Policy', 'concurrency'],
    };
    const { wrapper, calls } = await setup('docker', snapshot);
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).not.toContain('private-ref');
      expect(wrapper.text()).toContain('Referenced values stay on the server');
      expect(wrapper.text()).toContain('Set by the environment');
      expect(wrapper.get('[data-field="auto"]').attributes('disabled')).toBeDefined();
      expect(wrapper.get('[data-field="order"]').attributes('disabled')).toBeDefined();
      expect(wrapper.get<HTMLInputElement>('[data-field="concurrency"]').element.value).toBe('');
      expect(wrapper.get('[data-field="concurrency"]').attributes('disabled')).toBeUndefined();
      expect(wrapper.text()).toContain('other actions and notifications with the same name');
      expect(wrapper.text()).toContain('independent projects');
      expect(calls).toHaveLength(3);
    } finally {
      wrapper.unmount();
    }
  });
  it('keeps a named Local agent read-only', async () => {
    const { wrapper, calls } = await setup('docker', actionSnapshot('docker', 'Local'));
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      for (const field of ['auto', 'order', 'concurrency'])
        expect(wrapper.get(`[data-field="${field}"]`).attributes('disabled')).toBeDefined();
      expect(wrapper.get<HTMLInputElement>('[data-field="order"]').element.value).toBe('');
      expect(calls[1].path).toContain('Local');
    } finally {
      wrapper.unmount();
    }
  });
  it.each([400, 409])(
    'retains a rejected draft after HTTP%s without refresh or retry',
    async (status) => {
      const { wrapper, calls } = await setup('docker', actionSnapshot(), (_path, options) =>
        options?.method === 'PATCH'
          ? Response.json(
              actionOutcome({
                saved: false,
                applied: false,
                errors: [
                  {
                    path: 'order',
                    envKey: 'DD_ACTION_DOCKER_POLICY_ORDER',
                    message: 'Rejected policy',
                  },
                ],
              }),
              { status },
            )
          : undefined,
      );
      try {
        await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-field="order"]').setValue('-9');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.text()).toContain('Rejected policy');
        expect(wrapper.get<HTMLInputElement>('[data-field="order"]').element.value).toBe('-9');
        expect(calls).toHaveLength(4);
        if (status === 409) {
          expect(
            wrapper.get('[data-testid="save-action-policy"]').attributes('disabled'),
          ).toBeDefined();
          await wrapper.get('[data-testid="reload-action-policy"]').trigger('click');
          await flushPromises();
          expect(calls).toHaveLength(5);
        }
      } finally {
        wrapper.unmount();
      }
    },
  );
  it('locks uncertain saves until explicit reload', async () => {
    const { wrapper, calls } = await setup('docker', actionSnapshot(), (_path, options) =>
      options?.method === 'PATCH' ? Response.json({ saved: true }) : undefined,
    );
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-field="order"]').setValue('5');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.text()).toContain('could not be confirmed');
      expect(
        wrapper.get('[data-testid="save-action-policy"]').attributes('disabled'),
      ).toBeDefined();
      await wrapper.get('form').trigger('submit');
      expect(calls).toHaveLength(4);
    } finally {
      wrapper.unmount();
    }
  });
  it.each(['close', 'switch'] as const)('ignores an obsolete save after %s', async (action) => {
    const pending = Promise.withResolvers<Response>();
    const { wrapper, calls } = await setup('docker', actionSnapshot(), (_path, options) =>
      options?.method === 'PATCH' ? pending.promise : undefined,
    );
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-field="order"]').setValue('9');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      await wrapper
        .get(action === 'close' ? '.close-detail' : '.row-click-second')
        .trigger('click');
      await flushPromises();
      const count = calls.length;
      pending.resolve(Response.json(actionOutcome()));
      await flushPromises();
      expect(calls).toHaveLength(count);
      expect(wrapper.text()).not.toContain('Saved and applied');
    } finally {
      pending.resolve(Response.json(actionOutcome()));
      wrapper.unmount();
    }
  });
  it('uses translated field labels and modes', async () => {
    const locale = i18n.global.locale.value;
    i18n.global.locale.value = 'fr';
    const { wrapper } = await setup();
    try {
      await wrapper.get('[data-testid="edit-action-policy"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Déclenchement automatique');
      expect(wrapper.get('[data-field="auto"]').text()).toContain('Tous les conteneurs éligibles');
      expect(
        wrapper
          .findAll('label')
          .every((label) => wrapper.find(`#${label.attributes('for')}`).exists()),
      ).toBe(true);
    } finally {
      wrapper.unmount();
      i18n.global.locale.value = locale;
    }
  });
});
