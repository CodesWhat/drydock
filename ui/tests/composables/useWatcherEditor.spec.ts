import { effectScope, ref } from 'vue';
import { useWatcherEditor } from '@/composables/useWatcherEditor';
import {
  getWatcherEditor,
  saveWatcherEdits,
  WatcherEditorHttpError,
  type WatcherEditSnapshot,
} from '@/services/config-editor';

vi.mock('@/services/config-editor', async (original) => ({
  ...(await original<typeof import('@/services/config-editor')>()),
  getWatcherEditor: vi.fn(),
  saveWatcherEdits: vi.fn(),
}));

function snapshot(): WatcherEditSnapshot {
  return {
    available: true,
    revision: 'first',
    watchers: [
      {
        id: 'docker.local',
        name: 'local',
        fields: {
          cron: {
            present: true,
            source: 'file',
            path: ['watcher', 'local', 'cron'],
            value: '0 6 * * *',
            effectiveValue: '0 6 * * *',
          },
          maintenancewindow: {
            present: true,
            source: 'file',
            path: ['watcher', 'local', 'maintenancewindow'],
            value: '0 1 * * *',
          },
          maintenancewindowtz: {
            present: false,
            source: 'default',
            path: ['watcher', 'local', 'maintenancewindowtz'],
            effectiveValue: 'UTC',
          },
          maintenancewindowscope: {
            present: false,
            source: 'default',
            path: ['watcher', 'local', 'maintenancewindowscope'],
            effectiveValue: 'install',
          },
        },
      },
    ],
  };
}

describe('watcher editor state', () => {
  const scopes: ReturnType<typeof effectScope>[] = [];
  function setup() {
    const identity = ref({
      id: 'docker.local',
      name: 'local',
      agent: undefined as string | undefined,
    });
    const scope = effectScope();
    scopes.push(scope);
    return { identity, editor: scope.run(() => useWatcherEditor(() => identity.value))! };
  }
  beforeEach(() => {
    vi.mocked(getWatcherEditor).mockReset().mockResolvedValue(snapshot());
    vi.mocked(saveWatcherEdits).mockReset();
  });
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
  });

  it('loads only on explicit open and cancels without writes', async () => {
    const { editor } = setup();
    expect(getWatcherEditor).not.toHaveBeenCalled();
    await editor.open();
    expect(getWatcherEditor).toHaveBeenCalledTimes(1);
    editor.setValue('cron', '');
    expect(editor.changes.value).toEqual([
      { path: ['watcher', 'local', 'cron'], operation: 'set', value: '' },
    ]);
    editor.cancel();
    expect(editor.active.value).toBe(false);
    expect(saveWatcherEdits).not.toHaveBeenCalled();
  });

  it('sends dirty-only operations and distinguishes removal from a blank value', async () => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('cron', '0 7 * * *');
    editor.remove('maintenancewindow');
    vi.mocked(saveWatcherEdits).mockResolvedValue({
      status: 200,
      saved: true,
      applied: true,
      revision: 'second',
      changedKeys: [],
      restartRequired: [],
      errors: [],
    });
    await editor.save();
    expect(saveWatcherEdits).toHaveBeenCalledWith({
      revision: 'first',
      changes: [
        { path: ['watcher', 'local', 'cron'], operation: 'set', value: '0 7 * * *' },
        { path: ['watcher', 'local', 'maintenancewindow'], operation: 'remove' },
      ],
    });
    expect(editor.needsReload.value).toBe(true);
    expect(editor.canSave.value).toBe(false);
  });

  it('retains conflicts until an explicit discard and reload, never retries the write', async () => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('cron', 'draft');
    vi.mocked(saveWatcherEdits).mockResolvedValue({
      status: 409,
      saved: false,
      applied: false,
      changedKeys: [],
      restartRequired: [],
      errors: [],
    });
    await editor.save();
    expect(editor.conflict.value).toBe(true);
    expect(editor.drafts.value.cron?.value).toBe('draft');
    editor.setValue('cron', 'changed');
    editor.remove('cron');
    await editor.save();
    expect(editor.drafts.value.cron?.value).toBe('draft');
    expect(saveWatcherEdits).toHaveBeenCalledTimes(1);
    expect(getWatcherEditor).toHaveBeenCalledTimes(1);
    await editor.open();
    expect(editor.conflict.value).toBe(false);
    expect(editor.changes.value).toEqual([]);
  });

  it.each([
    [401, 'accessDenied'],
    [403, 'accessDenied'],
    [404, 'apiUnavailable'],
    [501, 'apiUnavailable'],
    [429, 'rateLimited'],
    [500, 'loadFailed'],
  ])('disables a failed snapshot HTTP%s', async (status, key) => {
    const { editor } = setup();
    vi.mocked(getWatcherEditor).mockRejectedValue(new WatcherEditorHttpError(status as number));
    await editor.open();
    expect(editor.errorKey.value).toBe(key);
    expect(editor.canSave.value).toBe(false);
    editor.setValue('cron', 'no');
    editor.remove('cron');
    await editor.save();
    expect(saveWatcherEdits).not.toHaveBeenCalled();
  });

  it('handles transport load errors and missing file, watcher and revision without writes', async () => {
    const { editor } = setup();
    vi.mocked(getWatcherEditor).mockRejectedValueOnce(new Error('offline'));
    await editor.open();
    expect(editor.errorKey.value).toBe('loadFailed');
    vi.mocked(getWatcherEditor).mockResolvedValueOnce({ ...snapshot(), available: false });
    await editor.open();
    expect(editor.errorKey.value).toBe('fileUnavailable');
    vi.mocked(getWatcherEditor).mockResolvedValueOnce({ ...snapshot(), watchers: [] });
    await editor.open();
    expect(editor.errorKey.value).toBe('watcherUnavailable');
    vi.mocked(getWatcherEditor).mockResolvedValueOnce({ ...snapshot(), revision: undefined });
    await editor.open();
    expect(editor.errorKey.value).toBe('watcherUnavailable');
  });

  it('disables editing when a malformed snapshot fails after partial initialization', async () => {
    const { editor } = setup();
    const malformed = snapshot();
    delete (malformed.watchers[0].fields as any).maintenancewindow;
    vi.mocked(getWatcherEditor).mockResolvedValue(malformed);
    await editor.open();
    expect(editor.errorKey.value).toBe('loadFailed');
    editor.setValue('cron', 'new');
    expect(editor.canSave.value).toBe(false);
    expect(editor.row.value).toBeUndefined();
  });

  it('matches exact id, name and agent and never treats a same-named agent as local', async () => {
    const { editor, identity } = setup();
    const data = snapshot();
    data.watchers.unshift({ ...data.watchers[0], id: 'Local.docker.local', agent: 'Local' });
    vi.mocked(getWatcherEditor).mockResolvedValue(data);
    await editor.open();
    expect(editor.row.value?.id).toBe('docker.local');
    identity.value = { id: 'Local.docker.local', name: 'local', agent: 'Local' };
    expect(editor.active.value).toBe(false);
    await editor.open();
    expect(editor.row.value?.agent).toBe('Local');
    expect(editor.editable('cron')).toBe(false);
    identity.value = { id: 'docker.local', name: 'different', agent: undefined };
    await editor.open();
    expect(editor.errorKey.value).toBe('watcherUnavailable');
    identity.value = { id: 'docker.local', name: 'local', agent: 'Local' };
    await editor.open();
    expect(editor.errorKey.value).toBe('watcherUnavailable');
  });

  it('keeps readonly/reference values out of edits and supports explicit defaults', async () => {
    const { editor } = setup();
    const data = snapshot();
    data.watchers[0].fields.cron = {
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
    };
    data.watchers[0].fields.maintenancewindow = {
      present: false,
      source: 'env',
      readOnlyReason: 'environment-owned',
    };
    vi.mocked(getWatcherEditor).mockResolvedValue(data);
    await editor.open();
    expect(editor.drafts.value.cron?.value).toBe('');
    expect(editor.drafts.value.maintenancewindow?.value).toBe('');
    editor.setValue('cron', 'new');
    editor.remove('cron');
    editor.remove('maintenancewindowtz');
    expect(editor.changes.value).toEqual([]);
    editor.setValue('maintenancewindowtz', 'UTC');
    expect(editor.changes.value).toEqual([
      { path: ['watcher', 'local', 'maintenancewindowtz'], operation: 'set', value: 'UTC' },
    ]);
  });

  it('returning to an existing value removes the operation', async () => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('cron', 'new');
    editor.setValue('cron', '0 6 * * *');
    expect(editor.changes.value).toEqual([]);
  });

  it('keeps the draft when parent detail refresh replaces the same exact identity', async () => {
    const { editor, identity } = setup();
    await editor.open();
    editor.setValue('cron', 'draft');
    identity.value = { ...identity.value };
    expect(editor.active.value).toBe(true);
    expect(editor.drafts.value.cron?.value).toBe('draft');
  });

  it('ignores late loads after cancellation or a newer explicit load', async () => {
    const { editor } = setup();
    let finish!: (data: WatcherEditSnapshot) => void;
    vi.mocked(getWatcherEditor).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const old = editor.open();
    await editor.open();
    expect(getWatcherEditor).toHaveBeenCalledTimes(1);
    editor.cancel();
    await editor.open();
    finish({ ...snapshot(), revision: 'obsolete' });
    await old;
    expect(editor.row.value?.id).toBe('docker.local');
    expect(editor.loading.value).toBe(false);
    let fail!: (error: Error) => void;
    vi.mocked(getWatcherEditor).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const pending = editor.open();
    editor.cancel();
    fail(new Error('late'));
    await pending;
    expect(editor.errorKey.value).toBe('');
  });

  it('freezes the submitted edit set while saving and ignores completion after row switch', async () => {
    const { editor, identity } = setup();
    await editor.open();
    editor.setValue('cron', 'draft');
    let finish!: (value: any) => void;
    vi.mocked(saveWatcherEdits).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const saving = editor.save();
    editor.setValue('cron', 'changed');
    editor.remove('cron');
    await editor.open();
    await editor.save();
    expect(saveWatcherEdits).toHaveBeenCalledTimes(1);
    expect(editor.drafts.value.cron?.value).toBe('draft');
    identity.value = { id: 'other', name: 'other', agent: undefined };
    finish({ saved: true, applied: true, errors: [] });
    await saving;
    expect(editor.result.value).toBeUndefined();
    expect(editor.saving.value).toBe(false);
  });

  it('preserves drafts on unknown save outcome and ignores late save errors after disposal', async () => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('cron', 'draft');
    vi.mocked(saveWatcherEdits).mockRejectedValueOnce(new Error('offline'));
    await editor.save();
    expect(editor.errorKey.value).toBe('saveUncertain');
    expect(editor.needsReload.value).toBe(true);
    expect(editor.drafts.value.cron?.value).toBe('draft');
    await editor.open();
    editor.setValue('cron', 'draft');
    let fail!: (error: Error) => void;
    vi.mocked(saveWatcherEdits).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const saving = editor.save();
    editor.cancel();
    fail(new Error('late'));
    await saving;
    expect(editor.errorKey.value).toBe('');
  });

  it.each([
    { saved: false, applied: false, errors: [] },
    {
      saved: true,
      applied: true,
      errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Audit failed' }],
    },
    {
      saved: true,
      applied: true,
      errors: [],
      reload: {
        applied: true,
        errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Reload error' }],
      },
    },
    {
      saved: true,
      applied: true,
      errors: [],
      reload: {
        applied: true,
        errors: [],
        reconcile: { added: 0, changed: 0, removed: 0, unchanged: 0, errors: 1 },
      },
    },
  ])('reports outcome problems honestly: %j', async (outcome) => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('cron', 'draft');
    vi.mocked(saveWatcherEdits).mockResolvedValue({
      status: 400,
      changedKeys: [],
      restartRequired: [],
      ...outcome,
    });
    await editor.save();
    expect(editor.hasProblems.value).toBe(true);
  });
});
