import { flushPromises } from '@vue/test-utils';
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
        if (path === '/api/v1/watchers') return Response.json({ data: [watcher], total: 1 });
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
