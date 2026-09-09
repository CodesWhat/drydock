import { effectScope, ref } from 'vue';
import { useNotificationEditor } from '@/composables/useNotificationEditor';
import {
  getNotificationEditor,
  NotificationEditorHttpError,
  type NotificationIdentity,
  saveNotificationEdits,
} from '@/services/notification-editor';
import { notificationOutcome, notificationSnapshot } from '../helpers/notification-editor';

vi.mock('@/services/notification-editor', async (original) => ({
  ...(await original<typeof import('@/services/notification-editor')>()),
  getNotificationEditor: vi.fn(),
  saveNotificationEdits: vi.fn(),
}));

describe('notification editor state', () => {
  const scopes: ReturnType<typeof effectScope>[] = [];
  function setup() {
    const identity = ref<NotificationIdentity>({
      id: 'discord.policy',
      type: 'discord',
      name: 'policy',
    });
    const scope = effectScope();
    scopes.push(scope);
    return { identity, editor: scope.run(() => useNotificationEditor(() => identity.value))! };
  }
  beforeEach(() => {
    vi.mocked(getNotificationEditor).mockReset().mockResolvedValue(notificationSnapshot());
    vi.mocked(saveNotificationEdits).mockReset().mockResolvedValue(notificationOutcome());
  });
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
  });
  it('keeps false/default values, dirty-only leaves, exact paths and explicit removal', async () => {
    const { editor } = setup();
    expect(getNotificationEditor).not.toHaveBeenCalled();
    await editor.save();
    editor.setValue('once', false);
    editor.remove('mode');
    expect(editor.changes.value).toEqual([]);
    await editor.open();
    expect(editor.drafts.value.resolvenotifications?.value).toBe(false);
    editor.setValue('once', 'false');
    editor.setValue('mode', false);
    expect(editor.changes.value).toEqual([]);
    editor.setValue('once', true);
    expect(editor.canSave.value).toBe(false);
    editor.setValue('once', false);
    editor.setValue('securitymode', 'simple');
    editor.remove('mode');
    editor.remove('resolvenotifications');
    await editor.save();
    expect(saveNotificationEdits).toHaveBeenCalledWith({
      revision: 'initial',
      changes: [
        { path: ['Notification', 'Discord', 'Policy', 'once'], operation: 'set', value: false },
        { path: ['Notification', 'Discord', 'Policy', 'mode'], operation: 'remove' },
        {
          path: ['Notification', 'Discord', 'Policy', 'securitymode'],
          operation: 'set',
          value: 'simple',
        },
      ],
    });
    expect(editor.needsReload.value).toBe(true);
    expect(editor.hasProblems.value).toBe(false);
    editor.cancel();
    expect(editor.active.value).toBe(false);
  });
  it('uses the real effective mode when a provider overrides a stored mode', async () => {
    const data = notificationSnapshot();
    data.triggers[0].fields.mode = {
      present: true,
      source: 'file',
      value: 'digest',
      effectiveValue: 'simple',
      readOnlyReason: 'provider-forced',
    };
    vi.mocked(getNotificationEditor).mockResolvedValue(data);
    const { editor } = setup();
    await editor.open();
    expect(editor.drafts.value.mode?.value).toBe('simple');
    expect(editor.editable('mode')).toBe(false);
  });
  it('normalizes case-insensitive policy scalars without changing untouched values', async () => {
    const data = notificationSnapshot();
    data.triggers[0].fields.once.value = 'TRUE';
    data.triggers[0].fields.mode.value = 'SIMPLE';
    data.triggers[0].fields.threshold.value = 'ALL';
    vi.mocked(getNotificationEditor).mockResolvedValue(data);
    const { editor } = setup();
    await editor.open();
    expect(editor.drafts.value.once?.value).toBe(true);
    expect(editor.drafts.value.mode?.value).toBe('simple');
    editor.setValue('once', true);
    editor.setValue('mode', 'simple');
    editor.setValue('threshold', 'all');
    expect(editor.changes.value).toEqual([]);
  });
  it('keeps reference, environment, absent and agent fields read-only and secret-free', async () => {
    const data = notificationSnapshot();
    data.triggers[0].fields.digestcron = {
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
    };
    data.triggers[0].fields.once = {
      present: true,
      source: 'env',
      readOnlyReason: 'environment-owned',
      effectiveValue: false,
    };
    data.triggers[0].fields.mode = { present: false, source: 'default' };
    vi.mocked(getNotificationEditor).mockResolvedValue(data);
    const { editor, identity } = setup();
    await editor.open();
    expect(editor.drafts.value.digestcron?.value).toBeUndefined();
    expect(editor.drafts.value.mode?.value).toBeUndefined();
    expect(editor.editable('once')).toBe(false);
    editor.setValue('once', true);
    editor.remove('once');
    expect(editor.changes.value).toEqual([]);
    data.triggers[0].agent = 'Local';
    identity.value = { ...identity.value, agent: 'Local' };
    await editor.open();
    expect(editor.drafts.value.threshold?.value).toBeUndefined();
    expect(editor.editable('threshold')).toBe(false);
  });
  it.each(['id', 'type', 'name', 'agent', 'category'] as const)(
    'requires matching notification ownership field %s',
    async (field) => {
      const data = notificationSnapshot();
      Object.assign(data.triggers[0], { [field]: 'different' });
      vi.mocked(getNotificationEditor).mockResolvedValue(data);
      const { editor } = setup();
      await editor.open();
      expect(editor.errorKey.value).toBe('triggerUnavailable');
      expect(editor.canSave.value).toBe(false);
    },
  );
  it.each([
    [401, 'accessDenied'],
    [403, 'accessDenied'],
    [404, 'apiUnavailable'],
    [501, 'apiUnavailable'],
    [429, 'rateLimited'],
    [500, 'loadFailed'],
  ] as const)('handles load HTTP%s', async (status, key) => {
    vi.mocked(getNotificationEditor).mockRejectedValue(new NotificationEditorHttpError(status));
    const { editor } = setup();
    await editor.open();
    expect(editor.errorKey.value).toBe(key);
    expect(editor.canSave.value).toBe(false);
  });
  it('fails closed on unavailable files, missing revisions and malformed snapshots', async () => {
    const { editor } = setup();
    vi.mocked(getNotificationEditor).mockResolvedValueOnce({
      ...notificationSnapshot(),
      available: false,
    });
    await editor.open();
    expect(editor.errorKey.value).toBe('fileUnavailable');
    vi.mocked(getNotificationEditor).mockResolvedValueOnce({
      ...notificationSnapshot(),
      revision: undefined,
    });
    await editor.open();
    expect(editor.errorKey.value).toBe('triggerUnavailable');
    const malformed = notificationSnapshot();
    delete (malformed.triggers[0].fields as Partial<(typeof malformed.triggers)[0]['fields']>).once;
    vi.mocked(getNotificationEditor).mockResolvedValueOnce(malformed);
    await editor.open();
    expect(editor.errorKey.value).toBe('loadFailed');
    expect(editor.row.value).toBeUndefined();
    expect(editor.canSave.value).toBe(false);
  });
  it('retains a409 draft, disables further edits and explicitly reloads without retry', async () => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('digestcron', '');
    vi.mocked(saveNotificationEdits).mockResolvedValueOnce(
      notificationOutcome({ status: 409, saved: false, applied: false }),
    );
    await editor.save();
    expect(editor.drafts.value.digestcron?.value).toBe('');
    expect(editor.conflict.value).toBe(true);
    editor.setValue('digestcron', 'new');
    editor.remove('mode');
    await editor.save();
    expect(saveNotificationEdits).toHaveBeenCalledTimes(1);
    await editor.open();
    expect(editor.changes.value).toEqual([]);
    expect(getNotificationEditor).toHaveBeenCalledTimes(2);
  });
  it('freezes concurrent save input and treats an uncertain outcome as reload-required', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(saveNotificationEdits).mockReturnValue(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    const { editor } = setup();
    await editor.open();
    editor.setValue('once', false);
    const pending = editor.save();
    await editor.save();
    await editor.open();
    editor.setValue('once', true);
    expect(saveNotificationEdits).toHaveBeenCalledTimes(1);
    expect(getNotificationEditor).toHaveBeenCalledTimes(1);
    reject(new Error('offline'));
    await pending;
    expect(editor.errorKey.value).toBe('saveUncertain');
    expect(editor.needsReload.value).toBe(true);
    expect(editor.drafts.value.once?.value).toBe(false);
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores obsolete load %s after identity switch',
    async (mode) => {
      let resolve!: (value: ReturnType<typeof notificationSnapshot>) => void,
        reject!: (error: Error) => void;
      vi.mocked(getNotificationEditor).mockReturnValueOnce(
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      const { editor, identity } = setup();
      const pending = editor.open();
      await editor.open();
      identity.value = { ...identity.value, type: 'smtp' };
      if (mode === 'resolve') resolve(notificationSnapshot());
      else reject(new Error('late'));
      await pending;
      expect(editor.row.value).toBeUndefined();
      expect(editor.errorKey.value).toBe('');
      expect(editor.loading.value).toBe(false);
    },
  );
  it.each(['resolve', 'reject'] as const)('ignores obsolete save %s after cancel', async (mode) => {
    let resolve!: (value: ReturnType<typeof notificationOutcome>) => void,
      reject!: (error: Error) => void;
    vi.mocked(saveNotificationEdits).mockReturnValueOnce(
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    const { editor } = setup();
    await editor.open();
    editor.setValue('once', false);
    const pending = editor.save();
    editor.cancel();
    if (mode === 'resolve') resolve(notificationOutcome());
    else reject(new Error('late'));
    await pending;
    expect(editor.result.value).toBeUndefined();
    expect(editor.errorKey.value).toBe('');
    expect(editor.saving.value).toBe(false);
  });
  it.each([
    notificationOutcome({ applied: false }),
    notificationOutcome({
      errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Audit failed' }],
    }),
    notificationOutcome({
      reload: {
        applied: true,
        errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Reload warning' }],
      },
    }),
    notificationOutcome({
      reload: {
        applied: true,
        errors: [],
        reconcile: { added: 0, changed: 1, removed: 0, unchanged: 0, errors: 1 },
      },
    }),
  ])('keeps partial and warning results visible', async (outcome) => {
    vi.mocked(saveNotificationEdits).mockResolvedValueOnce(outcome);
    const { editor, identity } = setup();
    await editor.open();
    editor.setValue('once', false);
    identity.value = { ...identity.value };
    expect(editor.canSave.value).toBe(true);
    await editor.save();
    expect(editor.hasProblems.value).toBe(true);
    expect(editor.result.value).toEqual(outcome);
  });
});
