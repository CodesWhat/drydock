import { flushPromises } from '@vue/test-utils';
import DetailField from '@/components/DetailField.vue';
import WatcherScheduleEditor from '@/components/WatcherScheduleEditor.vue';
import { resetPreferences } from '@/preferences/store';
import WatchersView from '@/views/WatchersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe('watcher detail editor API identity boundary', () => {
  beforeEach(() => resetPreferences());
  afterEach(() => vi.unstubAllGlobals());

  async function openEditor(
    agent: string | null | undefined,
    editorIdentity: { id: string; name: string; agent?: string } = {
      id: 'docker.local',
      name: 'local',
    },
    intercept?: (
      path: string,
      options: RequestInit | undefined,
    ) => Response | Promise<Response> | undefined,
  ) {
    const watcher = {
      id: 'docker.local',
      name: 'local',
      type: 'docker',
      agent,
      configuration: { cron: '0 6 * * *' },
    };
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        requests.push({ path, method: options?.method ?? 'GET' });
        const intercepted = intercept?.(path, options);
        if (intercepted) return intercepted;
        const other = { ...watcher, id: 'docker.other', name: 'other' };
        if (path === '/api/v1/watchers') return Response.json({ data: [watcher, other], total: 2 });
        if (path === '/api/v1/watchers/docker/other') return Response.json(other);
        if (path === `/api/v1/watchers/docker/local${agent ? `/${agent}` : ''}`)
          return Response.json(watcher);
        if (path === '/api/v1/config/editor/watchers')
          return Response.json({
            available: true,
            revision: 'x'.repeat(43),
            watchers: [
              {
                ...editorIdentity,
                fields: Object.fromEntries(
                  Object.entries({
                    cron: '0 6 * * *',
                    maintenancewindow: '0 1 * * *',
                    maintenancewindowtz: 'UTC',
                    maintenancewindowscope: 'install',
                  }).map(([field, value]) => [
                    field,
                    { present: true, source: 'file', path: ['watcher', 'local', field], value },
                  ]),
                ),
              },
            ],
          });
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    const wrapper = mountWithPlugins(WatchersView, { global: { stubs: dataViewStubs } });
    await flushPromises();
    await wrapper.get('.row-click-first').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(WatcherScheduleEditor).exists()).toBe(true);
    expect(requests).toHaveLength(2);
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    return { wrapper, requests };
  }

  it.each(['complete', 'audit-warning', 'partial'] as const)(
    'refreshes outer detail and matching table row after a %s save without losing editor outcome',
    async (mode) => {
      let saved = false;
      const values = {
        cron: '0 7 * * *',
        maintenancewindow: '0 2 * * *',
        maintenancewindowtz: 'America/New_York',
        maintenancewindowscope: 'scan',
      };
      const { wrapper, requests } = await openEditor(null, undefined, (path, options) => {
        if (options?.method === 'PATCH') {
          saved = true;
          return Response.json({
            saved: true,
            applied: mode !== 'partial',
            revision: 'new',
            changedKeys: [],
            restartRequired: [],
            errors:
              mode === 'complete'
                ? []
                : [
                    {
                      path: 'document',
                      envKey: 'DD_CONFIG_FILE',
                      message: mode === 'partial' ? 'Reload incomplete' : 'Audit failed',
                    },
                  ],
          });
        }
        if (saved && path === '/api/v1/watchers/docker/local')
          return Response.json({
            id: 'docker.local',
            name: 'local',
            type: 'docker',
            agent: null,
            configuration: values,
          });
      });
      try {
        for (const [field, value] of Object.entries(values))
          await wrapper.get(`[data-field="${field}"]`).setValue(value);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const rows = wrapper.findComponent(dataViewStubs.DataTable).props('rows');
        expect(rows.find((row: { id: string }) => row.id === 'docker.local').cron).toBe(
          values.cron,
        );
        expect(rows.find((row: { id: string }) => row.id === 'docker.other').cron).toBe(
          '0 6 * * *',
        );
        const detail = (label: string) =>
          wrapper
            .findAllComponents(DetailField)
            .find((field) => field.props('label') === label)!
            .text();
        expect(detail('Schedule')).toContain(values.cron);
        expect(detail('maintenancewindowtz')).toContain(values.maintenancewindowtz);
        expect(wrapper.get<HTMLInputElement>('[data-field="cron"]').element.value).toBe(
          values.cron,
        );
        expect(wrapper.get('[data-testid="save-schedule"]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain(
          mode === 'complete'
            ? 'Saved and applied'
            : mode === 'partial'
              ? 'Reload incomplete'
              : 'Audit failed',
        );
        expect(
          requests.filter(
            (request) =>
              request.path === '/api/v1/config/editor/watchers' && request.method === 'GET',
          ),
        ).toHaveLength(1);
        expect(requests).toHaveLength(5);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each([400, 409])(
    'does not refresh or discard editor draft after HTTP%s save refusal',
    async (status) => {
      const { wrapper, requests } = await openEditor(null, undefined, (_path, options) =>
        options?.method === 'PATCH'
          ? Response.json(
              {
                saved: false,
                applied: false,
                changedKeys: [],
                restartRequired: [],
                errors: [
                  { path: 'cron', envKey: 'DD_WATCHER_LOCAL_CRON', message: 'Rejected edit' },
                ],
              },
              { status },
            )
          : undefined,
      );
      try {
        await wrapper.get('[data-field="cron"]').setValue('draft');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('[data-field="cron"]').element.value).toBe('draft');
        expect(wrapper.text()).toContain('Rejected edit');
        expect(requests).toHaveLength(4);
      } finally {
        wrapper.unmount();
      }
    },
  );

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
    ...[{ reload: {} }, { reload: { errors: null } }, { restartRequired: null }].map((invalid) => ({
      status: 200,
      body: JSON.stringify({
        saved: true,
        applied: true,
        changedKeys: [],
        restartRequired: [],
        errors: [],
        ...invalid,
      }),
      contentType: 'application/json',
      message: 'The save outcome could not be confirmed',
    })),
  ])(
    'retains the draft without automatic requests after rejected HTTP$status ($body)',
    async ({ status, body, contentType, message }) => {
      const { wrapper, requests } = await openEditor(null, undefined, (_path, options) => {
        if (options?.method !== 'PATCH') return undefined;
        const response = new Response(body, { status });
        response.headers.set('content-type', contentType);
        return response;
      });
      try {
        await wrapper.get('[data-field="cron"]').setValue('0 7 * * *');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toContain(message);
        expect(wrapper.get<HTMLInputElement>('[data-field="cron"]').element.value).toBe(
          '0 7 * * *',
        );
        expect(wrapper.get('[data-testid="save-schedule"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-testid="reload-schedule"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Saved and applied');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(requests).toHaveLength(4);
        expect(requests.filter((request) => request.method === 'PATCH')).toHaveLength(1);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('does not refresh after an obsolete save resolves following panel close', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const { wrapper, requests } = await openEditor(null, undefined, (_path, options) =>
      options?.method === 'PATCH' ? pending : undefined,
    );
    try {
      await wrapper.get('[data-field="cron"]').setValue('draft');
      await wrapper.get('form').trigger('submit');
      await wrapper.get('.close-detail').trigger('click');
      finish(
        Response.json({
          saved: true,
          applied: true,
          changedKeys: [],
          restartRequired: [],
          errors: [],
        }),
      );
      await flushPromises();
      expect(requests).toHaveLength(4);
      expect(wrapper.findComponent(WatcherScheduleEditor).exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(['close', 'switch', 'failure'] as const)(
    'guards refresh on %s without clearing saved feedback',
    async (action) => {
      let finish!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        finish = resolve;
      });
      let saved = false;
      const { wrapper, requests } = await openEditor(null, undefined, (path, options) => {
        if (options?.method === 'PATCH') {
          saved = true;
          return Response.json({
            saved: true,
            applied: true,
            changedKeys: [],
            restartRequired: [],
            errors: [],
          });
        }
        if (saved && path === '/api/v1/watchers/docker/local') return pending;
      });
      try {
        await wrapper.get('[data-field="cron"]').setValue('draft');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(requests).toHaveLength(5);
        if (action === 'close') await wrapper.get('.close-detail').trigger('click');
        if (action === 'switch') {
          await wrapper.get('.row-click-second').trigger('click');
          await flushPromises();
        }
        finish(
          action === 'failure'
            ? Response.json({}, { status: 503 })
            : Response.json({
                id: 'docker.local',
                name: 'local',
                type: 'docker',
                agent: null,
                configuration: { cron: 'late' },
              }),
        );
        await flushPromises();
        const rows = wrapper.findComponent(dataViewStubs.DataTable).props('rows');
        expect(rows.find((row: { id: string }) => row.id === 'docker.local').cron).toBe(
          '0 6 * * *',
        );
        if (action === 'failure') {
          expect(wrapper.text()).toContain('Saved and applied');
          expect(wrapper.text()).toContain('Unable to load');
        }
        if (action === 'switch') expect(wrapper.get('.detail-header').text()).toContain('other');
        if (action === 'close')
          expect(wrapper.findComponent(WatcherScheduleEditor).exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each([null, undefined])(
    'opens local detail with agent %s against an agent-omitted editor row',
    async (agent) => {
      const { wrapper, requests } = await openEditor(agent);
      try {
        const cron = wrapper.get<HTMLInputElement>('[data-field="cron"]');
        expect(cron.element.disabled).toBe(false);
        expect(cron.element.value).toBe('0 6 * * *');
        await cron.setValue('0 7 * * *');
        expect(wrapper.get('[data-testid="save-schedule"]').attributes('disabled')).toBeUndefined();
        await wrapper.get('[data-testid="cancel-schedule"]').trigger('click');
        expect(requests).toHaveLength(3);
        expect(requests.every((request) => request.method === 'GET')).toBe(true);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each([
    ['Local', { id: 'docker.local', name: 'local' }],
    [null, { id: 'docker.local', name: 'local', agent: 'Local' }],
    ['edge', { id: 'docker.local', name: 'local', agent: 'Local' }],
    [null, { id: 'docker.other', name: 'local' }],
    [null, { id: 'docker.local', name: 'other' }],
  ] as const)(
    'keeps exact watcher ownership for detail agent %s and editor identity %j',
    async (agent, identity) => {
      const { wrapper, requests } = await openEditor(agent, identity);
      try {
        expect(wrapper.get('[role="alert"]').text()).toContain('not available');
        expect(wrapper.get('[data-testid="save-schedule"]').attributes('disabled')).toBeDefined();
        expect(requests.every((request) => request.method === 'GET')).toBe(true);
      } finally {
        wrapper.unmount();
      }
    },
  );
});
