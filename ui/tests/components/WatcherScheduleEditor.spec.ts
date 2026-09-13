import { flushPromises } from '@vue/test-utils';
import WatcherScheduleEditor from '@/components/WatcherScheduleEditor.vue';
import {
  getWatcherEditor,
  saveWatcherEdits,
  WatcherEditorHttpError,
} from '@/services/config-editor';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('@/services/config-editor', async (original) => ({
  ...(await original<typeof import('@/services/config-editor')>()),
  getWatcherEditor: vi.fn(),
  saveWatcherEdits: vi.fn(),
}));

describe('watcher schedule editor controls', () => {
  beforeEach(() => {
    vi.mocked(getWatcherEditor)
      .mockReset()
      .mockResolvedValue({
        available: true,
        revision: 'first',
        watchers: [
          {
            id: 'docker.local',
            name: 'local',
            fields: {
              cron: {
                path: ['watcher', 'local', 'cron'],
                present: true,
                source: 'file',
                value: '0 6 * * *',
              },
              maintenancewindow: {
                path: ['watcher', 'local', 'maintenancewindow'],
                present: true,
                source: 'file',
                value: '0 1 * * *',
              },
              maintenancewindowtz: {
                path: ['watcher', 'local', 'maintenancewindowtz'],
                present: false,
                source: 'default',
                effectiveValue: 'UTC',
              },
              maintenancewindowscope: {
                path: ['watcher', 'local', 'maintenancewindowscope'],
                present: false,
                source: 'default',
                effectiveValue: 'install',
              },
            },
          },
        ],
      });
    vi.mocked(saveWatcherEdits).mockReset();
  });

  it('loads on Edit, sends no write on Cancel, and submits only the changed input', async () => {
    const wrapper = mountWithPlugins(WatcherScheduleEditor, {
      props: { watcher: { id: 'docker.local', name: 'local' } },
    });
    expect(getWatcherEditor).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="edit-schedule"]').exists()).toBe(true);
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('input, select')).toHaveLength(4);
    await wrapper.get('[data-field="cron"]').setValue('');
    await wrapper.get('[data-testid="cancel-schedule"]').trigger('click');
    expect(saveWatcherEdits).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-field="cron"]').setValue('0 7 * * *');
    vi.mocked(saveWatcherEdits).mockResolvedValue({
      status: 200,
      saved: true,
      applied: true,
      revision: 'next',
      changedKeys: [],
      restartRequired: [],
      errors: [],
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(saveWatcherEdits).toHaveBeenCalledWith({
      revision: 'first',
      changes: [{ path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 7 * * *' }],
    });
    expect(wrapper.get('[role="status"]').text()).toContain('Saved and applied');
    wrapper.unmount();
  });

  it('shows a retained conflict draft and reloads only after explicitly discarding it', async () => {
    const wrapper = mountWithPlugins(WatcherScheduleEditor, {
      props: { watcher: { id: 'docker.local', name: 'local' } },
    });
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-field="cron"]').setValue('draft');
    vi.mocked(saveWatcherEdits).mockResolvedValue({
      status: 409,
      saved: false,
      applied: false,
      changedKeys: [],
      restartRequired: [],
      errors: [],
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Your draft is retained');
    expect((wrapper.get('[data-field="cron"]').element as HTMLInputElement).value).toBe('draft');
    expect(wrapper.get('[data-testid="save-schedule"]').attributes('disabled')).toBeDefined();
    expect(getWatcherEditor).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-testid="reload-schedule"]').trigger('click');
    await flushPromises();
    expect(getWatcherEditor).toHaveBeenCalledTimes(2);
    expect((wrapper.get('[data-field="cron"]').element as HTMLInputElement).value).toBe(
      '0 6 * * *',
    );
    expect(saveWatcherEdits).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('renders audit/reload errors, restart requirements and orphaned rules without a success banner', async () => {
    const wrapper = mountWithPlugins(WatcherScheduleEditor, {
      props: { watcher: { id: 'docker.local', name: 'local' } },
    });
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-reset="maintenancewindow"]').trigger('click');
    expect(wrapper.text()).toContain('will be removed');
    await wrapper.get('[data-field="maintenancewindowscope"]').setValue('scan');
    vi.mocked(saveWatcherEdits).mockResolvedValue({
      status: 200,
      saved: true,
      applied: true,
      changedKeys: [],
      restartRequired: ['server'],
      errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Audit failed' }],
      reload: {
        applied: true,
        errors: [{ path: 'watcher', envKey: 'DD_WATCHER', message: 'Reload warning' }],
        reconcile: { added: 1, changed: 2, removed: 3, unchanged: 4, errors: 1 },
        orphanedRules: [{ ruleId: 'rule-a', triggerId: 'missing-trigger' }],
      },
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Audit failed');
    expect(wrapper.text()).toContain('Reload warning');
    expect(wrapper.text()).toContain('Restart required for: server');
    expect(wrapper.text()).toContain('missing-trigger');
    expect(saveWatcherEdits).toHaveBeenCalledWith({
      revision: 'first',
      changes: [
        { path: ['watcher', 'local', 'maintenancewindow'], operation: 'remove' },
        { path: ['watcher', 'local', 'maintenancewindowscope'], operation: 'set', value: 'scan' },
      ],
    });
    wrapper.unmount();
  });

  it.each([
    [403, 'not authorized'],
    [404, 'does not provide'],
    [429, 'Too many'],
    [500, 'Could not load'],
  ])('shows an honest disabled editor for HTTP%s', async (status, message) => {
    vi.mocked(getWatcherEditor).mockRejectedValue(new WatcherEditorHttpError(status as number));
    const wrapper = mountWithPlugins(WatcherScheduleEditor, {
      props: { watcher: { id: 'docker.local', name: 'local' } },
    });
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(message);
    expect(wrapper.get('[data-testid="save-schedule"]').attributes('disabled')).toBeDefined();
    expect(saveWatcherEdits).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not render reference values and explains environment, agent and other read-only fields', async () => {
    vi.mocked(getWatcherEditor).mockResolvedValue({
      available: true,
      revision: 'first',
      watchers: [
        {
          id: 'edge.docker.local',
          name: 'local',
          agent: 'edge',
          fields: {
            cron: { present: true, source: 'reference', readOnlyReason: 'referenced-field' },
            maintenancewindow: {
              present: true,
              source: 'env',
              readOnlyReason: 'environment-owned',
            },
            maintenancewindowtz: { present: true, source: 'file', readOnlyReason: 'agent-watcher' },
            maintenancewindowscope: {
              present: true,
              source: 'file',
              readOnlyReason: 'ambiguous-field-alias',
            },
          },
        },
      ],
    });
    const wrapper = mountWithPlugins(WatcherScheduleEditor, {
      props: { watcher: { id: 'edge.docker.local', name: 'local', agent: 'edge' } },
    });
    await wrapper.get('[data-testid="edit-schedule"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('input:disabled, select:disabled')).toHaveLength(4);
    expect(wrapper.text()).toContain('Referenced values stay on the server');
    expect(wrapper.text()).toContain('Set by the environment');
    expect(wrapper.text()).toContain('Agent configuration is read-only');
    expect(wrapper.text()).toContain('not available for editing');
    expect(saveWatcherEdits).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
