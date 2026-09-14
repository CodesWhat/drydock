import { effectScope, ref } from 'vue';
import { useActionEditor } from '@/composables/useActionEditor';
import {
  ActionEditorHttpError,
  type ActionIdentity,
  getActionEditor,
  saveActionEdits,
} from '@/services/action-editor';
import { actionOutcome, actionSnapshot } from '../helpers/action-editor';

vi.mock('@/services/action-editor', async (original) => ({
  ...(await original<typeof import('@/services/action-editor')>()),
  getActionEditor: vi.fn(),
  saveActionEdits: vi.fn(),
}));
describe('action editor drafts', () => {
  const scopes: ReturnType<typeof effectScope>[] = [];
  beforeEach(() => {
    vi.mocked(getActionEditor).mockReset().mockResolvedValue(actionSnapshot());
    vi.mocked(saveActionEdits).mockReset().mockResolvedValue(actionOutcome());
  });
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
  });
  function setup() {
    const identity = ref<ActionIdentity>({ id: 'docker.policy', type: 'docker', name: 'policy' });
    const scope = effectScope();
    scopes.push(scope);
    const editor = scope.run(() => useActionEditor(() => identity.value));
    if (!editor) throw new Error('Missing active scope');
    return { editor, identity, scope };
  }
  it.each([true, false, 'ALL', 'OnInclude', 'ONAUTO', 'none'])(
    'normalizes auto %j only for display/no-op comparisons',
    async (auto) => {
      const snapshot = actionSnapshot();
      snapshot.actions[0].fields.auto.value = auto;
      vi.mocked(getActionEditor).mockResolvedValue(snapshot);
      const { editor } = setup();
      await editor.open();
      const canonical = typeof auto === 'boolean' ? (auto ? 'all' : 'none') : auto.toLowerCase();
      expect(editor.drafts.value.auto?.value).toBe(canonical);
      editor.setValue('auto', canonical);
      editor.setValue('order', '-2.50');
      expect(editor.changes.value).toEqual([]);
      expect(editor.canSave.value).toBe(false);
      await editor.save();
      expect(saveActionEdits).not.toHaveBeenCalled();
    },
  );
  it.each(['', ' ', 'Infinity', 'NaN'])(
    'refuses invalid order %j even alongside a valid change',
    async (value) => {
      const { editor } = setup();
      await editor.open();
      editor.setValue('auto', 'none');
      editor.setValue('order', value);
      expect(editor.invalid('order')).toBe(true);
      expect(editor.canSave.value).toBe(false);
      await editor.save();
      expect(saveActionEdits).not.toHaveBeenCalled();
    },
  );
  it('refuses unsupported auto values', async () => {
    const { editor } = setup();
    await editor.open();
    editor.setValue('auto', 'arbitrary');
    expect(editor.invalid('auto')).toBe(true);
    expect(editor.canSave.value).toBe(false);
  });
  it('shows inherited values but never invents withheld ones or creates untouched defaults', async () => {
    const snapshot = actionSnapshot();
    snapshot.actions[0].fields.order = {
      present: false,
      source: 'default',
      path: ['Action', 'Docker', 'Policy', 'order'],
      effectiveValue: -3.5,
    };
    snapshot.actions[0].fields.concurrency = {
      present: false,
      source: 'default',
      path: ['Action', 'Docker', 'Policy', 'concurrency'],
    };
    vi.mocked(getActionEditor).mockResolvedValue(snapshot);
    const { editor } = setup();
    await editor.open();
    expect(editor.drafts.value.order?.value).toBe('-3.5');
    expect(editor.drafts.value.concurrency?.value).toBe('');
    expect(editor.changes.value).toEqual([]);
    editor.remove('concurrency');
    expect(editor.changes.value).toEqual([]);
    editor.setValue('concurrency', '5');
    expect(editor.changes.value).toEqual([
      { path: ['Action', 'Docker', 'Policy', 'concurrency'], operation: 'set', value: 5 },
    ]);
  });
  it('keeps remote, reference and environment fields read-only and secret-free', async () => {
    const snapshot = actionSnapshot();
    snapshot.actions[0].fields.auto = {
      present: true,
      source: 'reference',
      readOnlyReason: 'referenced-field',
      value: 'private-reference',
      effectiveValue: 'private-reference',
    };
    snapshot.actions[0].fields.order = {
      present: true,
      source: 'env',
      readOnlyReason: 'environment-owned',
      effectiveValue: 4,
    };
    vi.mocked(getActionEditor).mockResolvedValue(snapshot);
    const { editor, identity } = setup();
    await editor.open();
    expect(editor.drafts.value.auto?.value).toBe('');
    expect(editor.editable('order')).toBe(false);
    editor.setValue('order', '5');
    editor.remove('order');
    expect(editor.changes.value).toEqual([]);
    snapshot.actions[0].agent = 'Local';
    identity.value = { ...identity.value, agent: 'Local' };
    await editor.open();
    expect(editor.drafts.value.order?.value).toBe('');
    expect(editor.editable('concurrency')).toBe(false);
  });
  it.each(['id', 'type', 'name', 'agent', 'category'] as const)(
    'requires exact %s identity',
    async (field) => {
      const snapshot = actionSnapshot();
      Object.assign(snapshot.actions[0], { [field]: 'other' });
      vi.mocked(getActionEditor).mockResolvedValue(snapshot);
      const { editor } = setup();
      await editor.open();
      expect(editor.errorKey.value).toBe('actionUnavailable');
    },
  );
  it('fails closed on unavailable file and missing revision', async () => {
    const snapshot = actionSnapshot();
    snapshot.available = false;
    vi.mocked(getActionEditor).mockResolvedValue(snapshot);
    const { editor } = setup();
    await editor.open();
    expect(editor.errorKey.value).toBe('fileUnavailable');
    expect(editor.canSave.value).toBe(false);
    snapshot.available = true;
    snapshot.revision = '';
    await editor.open();
    expect(editor.errorKey.value).toBe('actionUnavailable');
  });
  it('clears malformed snapshots and cannot save', async () => {
    vi.mocked(getActionEditor).mockResolvedValueOnce(
      JSON.parse(
        '{"available":true,"actions":[{"id":"docker.policy","type":"docker","name":"policy","category":"action"}],"revision":"initial"}',
      ),
    );
    const { editor } = setup();
    await editor.open();
    expect(editor.errorKey.value).toBe('loadFailed');
    expect(editor.row.value).toBeUndefined();
    expect(editor.changes.value).toEqual([]);
    editor.setValue('auto', 'all');
    editor.remove('auto');
    expect(editor.canSave.value).toBe(false);
  });
  it.each([
    [401, 'accessDenied'],
    [403, 'accessDenied'],
    [404, 'apiUnavailable'],
    [501, 'apiUnavailable'],
    [429, 'rateLimited'],
    [500, 'loadFailed'],
  ] as const)('maps load HTTP%s honestly', async (status, key) => {
    vi.mocked(getActionEditor).mockRejectedValueOnce(new ActionEditorHttpError(status));
    const { editor } = setup();
    await editor.open();
    expect(editor.errorKey.value).toBe(key);
  });
  it('does not apply a stale load or error after identity changes', async () => {
    const first = Promise.withResolvers<ReturnType<typeof actionSnapshot>>();
    vi.mocked(getActionEditor).mockReturnValueOnce(first.promise);
    const { editor, identity } = setup();
    const loading = editor.open();
    await editor.open();
    expect(getActionEditor).toHaveBeenCalledOnce();
    identity.value = { ...identity.value, name: 'other' };
    first.resolve(actionSnapshot());
    await loading;
    expect(editor.active.value).toBe(false);
    const second = Promise.withResolvers<ReturnType<typeof actionSnapshot>>();
    vi.mocked(getActionEditor).mockReturnValueOnce(second.promise);
    const obsolete = editor.open();
    editor.cancel();
    second.reject(new Error('obsolete'));
    await obsolete;
    expect(editor.errorKey.value).toBe('');
  });
  it('retains conflict drafts until explicit reload without retry', async () => {
    vi.mocked(saveActionEdits).mockResolvedValueOnce(
      actionOutcome({ status: 409, saved: false, applied: false }),
    );
    const { editor } = setup();
    await editor.open();
    editor.setValue('order', '-9');
    await editor.save();
    expect(editor.conflict.value).toBe(true);
    expect(editor.drafts.value.order?.value).toBe('-9');
    editor.setValue('order', '2');
    await editor.save();
    expect(saveActionEdits).toHaveBeenCalledOnce();
    await editor.open();
    expect(editor.drafts.value.order?.value).toBe('-2.5');
  });
  it('locks an in-flight save and ignores completion after disposal', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof actionOutcome>>();
    vi.mocked(saveActionEdits).mockReturnValueOnce(pending.promise);
    const { editor, scope } = setup();
    await editor.open();
    editor.setValue('auto', 'none');
    const saving = editor.save();
    editor.setValue('auto', 'all');
    editor.remove('auto');
    await editor.save();
    await editor.open();
    expect(getActionEditor).toHaveBeenCalledOnce();
    expect(editor.drafts.value.auto?.value).toBe('none');
    scope.stop();
    pending.resolve(actionOutcome());
    await saving;
    expect(editor.result.value).toBeUndefined();
  });
  it('requires reload after uncertainty and ignores stale rejection', async () => {
    vi.mocked(saveActionEdits).mockRejectedValueOnce(new Error('network'));
    const { editor } = setup();
    await editor.open();
    editor.setValue('auto', 'none');
    await editor.save();
    expect(editor.errorKey.value).toBe('saveUncertain');
    expect(editor.needsReload.value).toBe(true);
    await editor.open();
    const pending = Promise.withResolvers<ReturnType<typeof actionOutcome>>();
    vi.mocked(saveActionEdits).mockReturnValueOnce(pending.promise);
    editor.setValue('auto', 'none');
    const saving = editor.save();
    editor.cancel();
    pending.reject(new Error('old'));
    await saving;
    expect(editor.errorKey.value).toBe('');
  });
  it.each([
    actionOutcome(),
    actionOutcome({ applied: false }),
    actionOutcome({
      errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Audit failure' }],
    }),
    actionOutcome({ reload: { applied: false, errors: [] } }),
    actionOutcome({
      reload: {
        applied: true,
        errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message: 'Reload failure' }],
      },
    }),
    actionOutcome({
      reload: {
        applied: true,
        errors: [],
        reconcile: { added: 0, changed: 0, removed: 0, unchanged: 0, errors: 1 },
      },
    }),
    actionOutcome({
      reload: {
        applied: true,
        errors: [],
        reconcile: { added: 0, changed: 1, removed: 0, unchanged: 0, errors: 0 },
      },
    }),
  ])('distinguishes live application from reported problems %j', async (outcome) => {
    vi.mocked(saveActionEdits).mockResolvedValueOnce(outcome);
    const { editor } = setup();
    await editor.open();
    expect(editor.hasProblems.value).toBe(false);
    editor.setValue('order', '0');
    await editor.save();
    expect(editor.hasProblems.value).toBe(
      !outcome.applied ||
        outcome.errors.length > 0 ||
        outcome.reload?.applied === false ||
        (outcome.reload?.errors.length ?? 0) > 0 ||
        (outcome.reload?.reconcile?.errors ?? 0) > 0,
    );
  });
});
