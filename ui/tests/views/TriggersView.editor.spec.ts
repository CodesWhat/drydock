import { flushPromises } from '@vue/test-utils';
import NotificationPolicyEditor from '@/components/NotificationPolicyEditor.vue';
import { resetPreferences } from '@/preferences/store';
import TriggersView from '@/views/TriggersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';
import { notificationOutcome, notificationSnapshot } from '../helpers/notification-editor';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));

describe('notification policy editor integration', () => {
  beforeEach(() => resetPreferences());
  afterEach(() => vi.unstubAllGlobals());

  async function setup(
    intercept?: (path: string, options?: RequestInit) => Response | Promise<Response> | undefined,
    type = 'discord',
  ) {
    const calls: Array<{ path: string; method: string }> = [];
    const trigger = {
      id: `${type}.policy`,
      type,
      name: 'policy',
      agent: null,
      configuration: { mode: 'simple' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        calls.push({ path, method: options?.method ?? 'GET' });
        const response = intercept?.(path, options);
        if (response) return response;
        if (path === '/api/v1/triggers')
          return Response.json({
            data: [trigger, { ...trigger, id: 'smtp.other', type: 'smtp', name: 'other' }],
            total: 2,
          });
        if (path === '/api/v1/triggers/smtp/other')
          return Response.json({ ...trigger, id: 'smtp.other', type: 'smtp', name: 'other' });
        if (path === `/api/v1/triggers/${type}/policy`) return Response.json(trigger);
        if (path === '/api/v1/config/editor/triggers')
          return Response.json(
            options?.method === 'PATCH' ? notificationOutcome() : notificationSnapshot(),
          );
        throw new Error(`Unexpected ${path}`);
      }),
    );
    const wrapper = mountWithPlugins(TriggersView, { global: { stubs: dataViewStubs } });
    await flushPromises();
    await wrapper.get('.row-click-first').trigger('click');
    await flushPromises();
    if (type === 'discord') {
      await wrapper.get('[data-testid="edit-notification-policy"]').trigger('click');
      await flushPromises();
    }
    return { wrapper, calls };
  }

  it('cancels dirty fields and an explicit removal without any write', async () => {
    const { wrapper, calls } = await setup();
    try {
      await wrapper.get('[data-field="once"]').setValue('false');
      await wrapper.get('[data-reset="mode"]').trigger('click');
      expect(wrapper.text()).toContain('This file value will be removed');
      await wrapper.get('[data-testid="cancel-notification-policy"]').trigger('click');
      expect(wrapper.find('form').exists()).toBe(false);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it('renders source ownership, forced values and false without exposing reference contents', async () => {
    const snapshot = notificationSnapshot(),
      fields = snapshot.triggers[0].fields;
    fields.once = {
      present: true,
      source: 'env',
      value: false,
      effectiveValue: false,
      readOnlyReason: 'environment-owned',
    };
    fields.mode = {
      present: true,
      source: 'file',
      value: 'digest',
      effectiveValue: 'simple',
      readOnlyReason: 'provider-forced',
    };
    fields.digestcron = {
      present: true,
      source: 'reference',
      value: 'private-reference',
      effectiveValue: 'private-effective',
      readOnlyReason: 'referenced-field',
    };
    fields.threshold = { present: true, source: 'file', readOnlyReason: 'ambiguous-field-alias' };
    const { wrapper, calls } = await setup((path) =>
      path === '/api/v1/config/editor/triggers' ? Response.json(snapshot) : undefined,
    );
    try {
      for (const field of ['once', 'mode', 'digestcron', 'threshold'])
        expect(wrapper.get(`[data-field="${field}"]`).attributes('disabled')).toBeDefined();
      expect(wrapper.get<HTMLSelectElement>('[data-field="once"]').element.value).toBe('false');
      expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').element.value).toBe('simple');
      expect(wrapper.text()).toContain('This provider controls this value');
      expect(wrapper.text()).toContain('Source: reference');
      expect(wrapper.html()).not.toContain('private-reference');
      expect(wrapper.html()).not.toContain('private-effective');
      expect(calls).toHaveLength(3);
    } finally {
      wrapper.unmount();
    }
  });

  it.each([403, 404, 500])(
    'shows an honest disabled state after snapshot HTTP%s',
    async (status) => {
      const { wrapper, calls } = await setup((path) =>
        path === '/api/v1/config/editor/triggers' ? new Response('', { status }) : undefined,
      );
      try {
        expect(wrapper.get('[role="alert"]').text()).toContain(
          status === 403
            ? 'not authorized'
            : status === 404
              ? 'does not provide'
              : 'Could not load',
        );
        expect(
          wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
        ).toBeDefined();
        expect(wrapper.find('[data-field]').exists()).toBe(false);
        expect(calls).toHaveLength(3);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each([{ id: 'smtp.policy' }, { type: 'smtp' }, { name: 'other' }, { agent: 'Local' }])(
    'does not edit another exact owner %j',
    async (mismatch) => {
      const snapshot = notificationSnapshot();
      Object.assign(snapshot.triggers[0], mismatch);
      const { wrapper, calls } = await setup((path) =>
        path === '/api/v1/config/editor/triggers' ? Response.json(snapshot) : undefined,
      );
      try {
        expect(wrapper.text()).toContain('This exact notification trigger');
        expect(
          wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
        ).toBeDefined();
        expect(calls).toHaveLength(3);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('keeps a named Local agent distinct and all of its policy fields read-only', async () => {
    const snapshot = notificationSnapshot();
    snapshot.triggers[0].agent = 'Local';
    for (const descriptor of Object.values(snapshot.triggers[0].fields)) {
      descriptor.readOnlyReason = 'agent-trigger';
      descriptor.value = 'private-agent-value';
      descriptor.effectiveValue = 'private-agent-effective';
    }
    const trigger = {
      id: 'discord.policy',
      type: 'discord',
      name: 'policy',
      agent: 'Local',
      configuration: {},
    };
    const { wrapper, calls } = await setup((path) => {
      if (path === '/api/v1/triggers') return Response.json({ data: [trigger], total: 1 });
      if (path === '/api/v1/triggers/discord/policy/Local') return Response.json(trigger);
      if (path === '/api/v1/config/editor/triggers') return Response.json(snapshot);
    });
    try {
      expect(wrapper.text()).toContain('Agent configuration is read-only');
      expect(wrapper.html()).not.toContain('private-agent');
      for (const field of wrapper.findAll('[data-field]'))
        expect(field.attributes('disabled')).toBeDefined();
      expect(calls.map((call) => call.path)).toContain('/api/v1/triggers/discord/policy/Local');
    } finally {
      wrapper.unmount();
    }
  });

  it('requires explicit reload after an unknown save and never retries it', async () => {
    const { wrapper, calls } = await setup((_path, options) =>
      options?.method === 'PATCH' ? new Response('', { status: 504 }) : undefined,
    );
    try {
      await wrapper.get('[data-field="mode"]').setValue('digest');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.text()).toContain('save outcome could not be confirmed');
      expect(
        wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
      ).toBeDefined();
      expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').element.value).toBe('digest');
      expect(calls).toHaveLength(4);
    } finally {
      wrapper.unmount();
    }
  });

  it.each([
    {
      status: 401,
      body: 'Unauthorized',
      contentType: '',
      message: 'Your session is not authorized',
    },
    {
      status: 403,
      body: 'Forbidden',
      contentType: 'text/plain',
      message: 'Your session is not authorized',
    },
    {
      status: 429,
      body: 'Too many requests',
      contentType: 'text/plain',
      message: 'Too many editor requests',
    },
    {
      status: 502,
      body: 'Bad gateway',
      contentType: 'text/plain',
      message: 'The save outcome could not be confirmed',
    },
    {
      status: 200,
      body: 'invalid JSON',
      contentType: 'application/json',
      message: 'The save outcome could not be confirmed',
    },
    ...[{}, { errors: null }, { errors: [] }, { applied: 'false', errors: [] }].map((reload) => ({
      status: 200,
      body: JSON.stringify({ ...notificationOutcome(), reload }),
      contentType: 'application/json',
      message: 'The save outcome could not be confirmed',
    })),
  ])(
    'retains the draft without automatic requests after rejected HTTP$status ($body)',
    async ({ status, body, contentType, message }) => {
      const { wrapper, calls } = await setup((_path, options) => {
        if (options?.method !== 'PATCH') return undefined;
        const response = new Response(body, { status });
        response.headers.set('content-type', contentType);
        return response;
      });
      try {
        await wrapper.get('[data-field="mode"]').setValue('digest');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toContain(message);
        expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').element.value).toBe('digest');
        expect(
          wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
        ).toBeDefined();
        expect(wrapper.find('[data-testid="reload-notification-policy"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Saved and applied');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(calls).toHaveLength(4);
        expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('reports a missing configuration file without enabling any edit', async () => {
    const { wrapper, calls } = await setup((path) =>
      path === '/api/v1/config/editor/triggers'
        ? Response.json({ available: false, triggers: [] })
        : undefined,
    );
    try {
      expect(wrapper.text()).toContain('No configuration file is available');
      expect(wrapper.find('[data-field]').exists()).toBe(false);
      expect(
        wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
      ).toBeDefined();
      expect(calls).toHaveLength(3);
    } finally {
      wrapper.unmount();
    }
  });

  it('serializes explicit removal separately from an empty cron draft', async () => {
    let body: unknown;
    const { wrapper } = await setup((_path, options) => {
      if (options?.method === 'PATCH') {
        body = JSON.parse(String(options.body));
        return Response.json(notificationOutcome({ saved: false, applied: false }));
      }
    });
    try {
      await wrapper.get('[data-reset="mode"]').trigger('click');
      await wrapper.get('[data-field="digestcron"]').setValue('');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(body).toEqual({
        revision: 'initial',
        changes: [
          { path: ['Notification', 'Discord', 'Policy', 'mode'], operation: 'remove' },
          {
            path: ['Notification', 'Discord', 'Policy', 'digestcron'],
            operation: 'set',
            value: '',
          },
        ],
      });
    } finally {
      wrapper.unmount();
    }
  });

  it.each(['docker', 'dockercompose', 'portainer', 'command'])(
    'does not offer policy editing for action provider %s',
    async (type) => {
      const { wrapper, calls } = await setup(undefined, type);
      try {
        expect(wrapper.findComponent(NotificationPolicyEditor).exists()).toBe(false);
        expect(calls).toHaveLength(2);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each([400, 409])('keeps the draft and does not refresh after HTTP%s', async (status) => {
    const { wrapper, calls } = await setup((_path, options) =>
      options?.method === 'PATCH'
        ? Response.json(
            notificationOutcome({
              saved: false,
              applied: false,
              errors: [
                {
                  path: 'mode',
                  envKey: 'DD_NOTIFICATION_DISCORD_POLICY_MODE',
                  message: 'Rejected edit',
                },
              ],
            }),
            { status },
          )
        : undefined,
    );
    try {
      await wrapper.get('[data-field="mode"]').setValue('digest');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').element.value).toBe('digest');
      expect(wrapper.text()).toContain('Rejected edit');
      expect(calls).toHaveLength(4);
      if (status === 409) {
        expect(
          wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
        ).toBeDefined();
        await wrapper.get('[data-testid="reload-notification-policy"]').trigger('click');
        await flushPromises();
        expect(calls).toHaveLength(5);
        expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').element.value).toBe('simple');
      }
    } finally {
      wrapper.unmount();
    }
  });

  it.each(['partial', 'audit', 'contradictory-reload'] as const)(
    'refreshes only the matching outer row after a saved %s outcome and preserves feedback',
    async (kind) => {
      let saved = false;
      const { wrapper, calls } = await setup((path, options) => {
        if (options?.method === 'PATCH') {
          saved = true;
          return Response.json(
            notificationOutcome({
              applied: kind !== 'partial',
              errors:
                kind === 'contradictory-reload'
                  ? []
                  : [
                      {
                        path: 'document',
                        envKey: 'DD_CONFIG_FILE',
                        message: kind === 'audit' ? 'Audit failed' : 'Reload incomplete',
                      },
                    ],
              restartRequired: ['DD_EXAMPLE'],
              reload: {
                applied: kind === 'audit',
                errors: [],
                reconcile: { added: 0, changed: 1, removed: 0, unchanged: 0, errors: 0 },
                orphanedRules: [{ ruleId: 'rule-1', triggerId: 'old' }],
              },
            }),
          );
        }
        if (saved && path === '/api/v1/triggers/discord/policy')
          return Response.json({
            id: 'discord.policy',
            type: 'discord',
            name: 'policy',
            agent: null,
            configuration: { mode: 'digest' },
          });
      });
      try {
        await wrapper.get('[data-field="mode"]').setValue('digest');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(calls).toHaveLength(5);
        if (kind === 'contradictory-reload') {
          expect(wrapper.get('[role="alert"]').text()).toContain('operation reported problems');
          expect(wrapper.text()).not.toContain('Saved and applied');
        } else {
          expect(wrapper.text()).toContain(kind === 'audit' ? 'Audit failed' : 'Reload incomplete');
        }
        expect(wrapper.text()).toContain('DD_EXAMPLE');
        expect(wrapper.text()).toContain('rule-1');
        expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').element.value).toBe('digest');
        const rows = wrapper.findComponent(dataViewStubs.DataTable).props('rows');
        expect(rows[0].config.mode).toBe('digest');
        expect(rows[1].config.mode).toBe('simple');
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('ignores an obsolete save after closing the detail', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const { wrapper, calls } = await setup((_path, options) =>
      options?.method === 'PATCH' ? pending : undefined,
    );
    try {
      await wrapper.get('[data-field="mode"]').setValue('digest');
      await wrapper.get('form').trigger('submit');
      await wrapper.get('.close-detail').trigger('click');
      finish(Response.json(notificationOutcome()));
      await flushPromises();
      expect(calls).toHaveLength(4);
      expect(wrapper.findComponent(NotificationPolicyEditor).exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(['close', 'switch', 'failure'])(
    'guards an outer detail refresh on %s',
    async (action) => {
      let saved = false;
      let finish!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      const { wrapper, calls } = await setup((path, options) => {
        if (options?.method === 'PATCH') {
          saved = true;
          return Response.json(notificationOutcome());
        }
        if (saved && path === '/api/v1/triggers/discord/policy') return pending;
      });
      try {
        await wrapper.get('[data-field="mode"]').setValue('digest');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        if (action === 'close') await wrapper.get('.close-detail').trigger('click');
        if (action === 'switch') await wrapper.get('.row-click-second').trigger('click');
        finish(
          action === 'failure'
            ? Response.json({ error: 'failed' }, { status: 500 })
            : Response.json({
                id: 'discord.policy',
                type: 'discord',
                name: 'policy',
                configuration: { mode: 'digest' },
              }),
        );
        await flushPromises();
        expect(wrapper.findComponent(dataViewStubs.DataTable).props('rows')[0].config.mode).toBe(
          'simple',
        );
        if (action === 'failure') expect(wrapper.text()).toContain('Saved and applied');
        expect(
          calls.filter(
            (call) => call.path === '/api/v1/config/editor/triggers' && call.method === 'GET',
          ),
        ).toHaveLength(1);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('loads only on Edit and saves six typed fields without running a trigger', async () => {
    const current = {
      threshold: 'all',
      once: true,
      mode: 'simple',
      securitymode: 'simple',
      digestcron: '0 8 * * *',
      resolvenotifications: false,
    };
    const changed = {
      threshold: 'minor-only-no-digest',
      once: false,
      mode: 'digest',
      securitymode: 'batch+digest',
      digestcron: '0 9 * * *',
      resolvenotifications: true,
    };
    const identity = { id: 'discord.policy', type: 'discord', name: 'policy' };
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    let saved = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        calls.push({
          path,
          method: options?.method ?? 'GET',
          body: options?.body ? JSON.parse(String(options.body)) : undefined,
        });
        const trigger = { ...identity, agent: null, configuration: saved ? changed : current };
        if (path === '/api/v1/triggers') return Response.json({ data: [trigger], total: 1 });
        if (path === '/api/v1/triggers/discord/policy') return Response.json(trigger);
        if (path === '/api/v1/config/editor/triggers' && options?.method === 'PATCH') {
          saved = true;
          return Response.json({
            saved: true,
            applied: true,
            revision: 'new',
            changedKeys: [],
            restartRequired: [],
            errors: [],
          });
        }
        if (path === '/api/v1/config/editor/triggers')
          return Response.json({
            available: true,
            revision: 'revision',
            triggers: [
              {
                ...identity,
                category: 'notification',
                fields: Object.fromEntries(
                  Object.entries(current).map(([field, value]) => [
                    field,
                    {
                      path: ['Notification', 'Discord', 'Policy', field],
                      present: true,
                      source: 'file',
                      value,
                      effectiveValue: value,
                    },
                  ]),
                ),
              },
            ],
          });
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    const wrapper = mountWithPlugins(TriggersView, { global: { stubs: dataViewStubs } });
    try {
      await flushPromises();
      await wrapper.get('.row-click-first').trigger('click');
      await flushPromises();
      expect(calls).toHaveLength(2);
      expect(wrapper.find('[data-testid="edit-notification-policy"]').exists()).toBe(true);
      await wrapper.get('[data-testid="edit-notification-policy"]').trigger('click');
      await flushPromises();
      expect(wrapper.findAll('[data-field]')).toHaveLength(6);
      expect(
        wrapper.get<HTMLSelectElement>('[data-field="threshold"]').findAll('option'),
      ).toHaveLength(12);
      expect(wrapper.get<HTMLSelectElement>('[data-field="mode"]').findAll('option')).toHaveLength(
        4,
      );
      for (const [field, value] of Object.entries(changed))
        await wrapper.get(`[data-field="${field}"]`).setValue(String(value));
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(calls.filter((call) => call.method === 'PATCH')).toEqual([
        {
          path: '/api/v1/config/editor/triggers',
          method: 'PATCH',
          body: {
            revision: 'revision',
            changes: Object.entries(changed).map(([field, value]) => ({
              path: ['Notification', 'Discord', 'Policy', field],
              operation: 'set',
              value,
            })),
          },
        },
      ]);
      expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
      expect(calls).toHaveLength(5);
      expect(wrapper.findComponent(dataViewStubs.DataTable).props('rows')[0].config).toEqual(
        changed,
      );
      expect(wrapper.text()).toContain('Saved and applied');
    } finally {
      wrapper.unmount();
    }
  });
});
