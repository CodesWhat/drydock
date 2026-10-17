import { ref } from 'vue';
import {
  buildIconValue,
  failureFromError,
  fieldErrors,
  ICON_PROVIDERS,
  isValidIconSlug,
  LABEL_OVERRIDE_GROUPS,
  parseIconValue,
  useLabelOverrides,
  validateDisplayNameDraft,
} from '@/composables/useLabelOverrides';
import {
  getLabelOverrides,
  LabelOverrideHttpError,
  type LabelOverrideSnapshot,
  patchLabelOverrides,
  resetLabelOverrides,
} from '@/services/label-override';

vi.mock('@/services/label-override', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/label-override')>()),
  getLabelOverrides: vi.fn(),
  patchLabelOverrides: vi.fn(),
  resetLabelOverrides: vi.fn(),
}));

function snapshot(overrides: Partial<LabelOverrideSnapshot> = {}): LabelOverrideSnapshot {
  return {
    containerId: 'c1',
    scope: { kind: 'container', agent: null, watcher: 'local', name: 'web', appliesTo: [] },
    overrideId: 'o1',
    revision: 2,
    readOnlyReason: null,
    agentEnforcedActionRouting: false,
    fields: {} as LabelOverrideSnapshot['fields'],
    warnings: [],
    ...overrides,
  };
}
const write = (overrides: Partial<LabelOverrideSnapshot> = {}) => ({
  ...snapshot({ revision: 3, ...overrides }),
  changed: ['displayName' as const],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(getLabelOverrides).mockReset();
  vi.mocked(patchLabelOverrides).mockReset();
  vi.mocked(resetLabelOverrides).mockReset();
});

describe('draft validation', () => {
  it('accepts a trimmed display name and flags the server rules', () => {
    expect(validateDisplayNameDraft('  TV  ')).toBeNull();
    expect(validateDisplayNameDraft('   ')).toBe('empty');
    expect(validateDisplayNameDraft('x'.repeat(128))).toBeNull();
    expect(validateDisplayNameDraft('x'.repeat(129))).toBe('tooLong');
    expect(validateDisplayNameDraft('😀'.repeat(128))).toBeNull();
    expect(validateDisplayNameDraft('a<b')).toBe('invalidCharacters');
    expect(validateDisplayNameDraft('a>b')).toBe('invalidCharacters');
    expect(validateDisplayNameDraft('a\u0007b')).toBe('invalidCharacters');
    expect(validateDisplayNameDraft('a\u0085b')).toBe('invalidCharacters');
    expect(validateDisplayNameDraft('a‮b')).toBe('invalidCharacters');
    expect(validateDisplayNameDraft('a⁧b')).toBe('invalidCharacters');
  });

  it('accepts only slugs the icon proxy accepts', () => {
    expect(isValidIconSlug('sonarr')).toBe(true);
    expect(isValidIconSlug('Home-Assistant_2.x')).toBe(true);
    expect(isValidIconSlug('a'.repeat(128))).toBe(true);
    expect(isValidIconSlug('a'.repeat(129))).toBe(false);
    expect(isValidIconSlug('')).toBe(false);
    expect(isValidIconSlug('-x')).toBe(false);
    expect(isValidIconSlug('a/b')).toBe(false);
    expect(isValidIconSlug('https://example.com/x.png')).toBe(false);
    expect(isValidIconSlug(' sonarr')).toBe(false);
  });

  it('builds the canonical icon value and parses slug forms back', () => {
    expect(ICON_PROVIDERS).toEqual(['sh', 'hl', 'si']);
    expect(buildIconValue('hl', 'sonarr')).toBe('hl:sonarr');
    expect(parseIconValue('sh:sonarr')).toEqual({ provider: 'sh', slug: 'sonarr' });
    expect(parseIconValue('SI-github')).toEqual({ provider: 'si', slug: 'github' });
    expect(parseIconValue('mdi:docker')).toBeNull();
    expect(parseIconValue('https://example.com/a.png')).toBeNull();
    expect(parseIconValue('sh:a/b')).toBeNull();
    expect(parseIconValue(null)).toBeNull();
    expect(parseIconValue(['sh:a'])).toBeNull();
  });

  it('knows the groups and which fields are editable here', () => {
    expect(LABEL_OVERRIDE_GROUPS.map((group) => group.id)).toEqual([
      'display',
      'dependencies',
      'notification',
      'action',
    ]);
    expect(LABEL_OVERRIDE_GROUPS.flatMap((group) => group.fields)).toHaveLength(9);
  });
});

describe('failureFromError', () => {
  const http = (
    status: number,
    extras: ConstructorParameters<typeof LabelOverrideHttpError>[2] = {},
  ) => new LabelOverrideHttpError(status, 'server said', extras);

  it('classifies each status the API returns', () => {
    expect(failureFromError(http(400, { errors: [{ field: 'displayName', code: 'x' }] }))).toEqual({
      kind: 'validation',
      message: 'server said',
      errors: [{ field: 'displayName', code: 'x' }],
    });
    expect(failureFromError(http(403)).kind).toBe('forbidden');
    expect(failureFromError(http(401)).kind).toBe('forbidden');
    expect(failureFromError(http(404)).kind).toBe('notFound');
    expect(failureFromError(http(409, { snapshot: snapshot() })).kind).toBe('conflict');
    expect(failureFromError(http(409, { readOnlyReason: 'rollback-container' })).kind).toBe(
      'readOnly',
    );
    expect(failureFromError(http(409)).kind).toBe('notOverridable');
    expect(failureFromError(http(422, { cycle: ['a', 'b'] }))).toMatchObject({
      kind: 'cycle',
      cycle: ['a', 'b'],
    });
    expect(failureFromError(http(500)).kind).toBe('unknown');
  });

  it('treats a network failure as an unknown outcome', () => {
    expect(failureFromError(new Error('offline'))).toMatchObject({
      kind: 'unknown',
      message: 'offline',
    });
    expect(failureFromError('boom').kind).toBe('unknown');
    expect(failureFromError(undefined).message).toBe('Could not save the label override');
  });

  it('lists the server errors for one field, with their entries', () => {
    const failure = failureFromError(
      http(400, {
        errors: [
          { field: 'displayIcon', code: 'invalid-icon' },
          { field: 'actionTriggerInclude', code: 'unknown-trigger-reference', entries: ['x.y'] },
          { field: 'displayName', code: 'display-name-empty' },
        ],
      }),
    );
    expect(fieldErrors(failure, 'displayIcon')).toEqual([{ code: 'invalid-icon', entries: [] }]);
    expect(fieldErrors(failure, 'actionTriggerInclude')).toEqual([
      { code: 'unknown-trigger-reference', entries: ['x.y'] },
    ]);
    expect(fieldErrors(failure, 'dependsOn')).toEqual([]);
    expect(fieldErrors(null, 'displayIcon')).toEqual([]);
    expect(fieldErrors(failureFromError(http(500)), 'displayIcon')).toEqual([]);
  });
});

describe('useLabelOverrides', () => {
  it('loads the snapshot for the container', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({ warnings: [{ field: 'f', code: 'c' }] }),
    );
    const state = useLabelOverrides(ref('c1'));
    expect(state.snapshot.value).toBeNull();
    const pending = state.load();
    expect(state.loading.value).toBe(true);
    await pending;
    expect(state.loading.value).toBe(false);
    expect(state.snapshot.value?.revision).toBe(2);
    expect(state.warnings.value).toEqual([{ field: 'f', code: 'c' }]);
    expect(state.readOnly.value).toBe(false);
  });

  it('reports a load failure and clears it on the next load', async () => {
    vi.mocked(getLabelOverrides).mockRejectedValueOnce(new Error('down'));
    const state = useLabelOverrides(ref('c1'));
    await state.load();
    expect(state.loadError.value).toBe('down');
    expect(state.snapshot.value).toBeNull();
    expect(state.warnings.value).toEqual([]);
    vi.mocked(getLabelOverrides).mockResolvedValueOnce(snapshot());
    await state.load();
    expect(state.loadError.value).toBe('');
  });

  it('uses a fallback message when the load error has none', async () => {
    vi.mocked(getLabelOverrides).mockRejectedValueOnce(undefined);
    const state = useLabelOverrides(ref('c1'));
    await state.load();
    expect(state.loadError.value).toBe('Failed to load label overrides');
  });

  it('reports a container the API says is not overridable', async () => {
    vi.mocked(getLabelOverrides).mockRejectedValue(
      new LabelOverrideHttpError(409, 'The container has no label override scope'),
    );
    const state = useLabelOverrides(ref('c1'));
    await state.load();
    expect(state.notOverridable.value).toBe('The container has no label override scope');
    expect(state.loadError.value).toBe('');
  });

  it('is read only for a rollback container', async () => {
    vi.mocked(getLabelOverrides).mockResolvedValue(
      snapshot({ readOnlyReason: 'rollback-container' }),
    );
    const state = useLabelOverrides(ref('c1'));
    await state.load();
    expect(state.readOnly.value).toBe(true);
  });

  it('discards a load that finished after the container changed', async () => {
    const first = deferred<LabelOverrideSnapshot>();
    vi.mocked(getLabelOverrides)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(snapshot({ containerId: 'c2', revision: 9 }));
    const id = ref('c1');
    const state = useLabelOverrides(id);
    const slow = state.load();
    id.value = 'c2';
    await state.load();
    first.resolve(snapshot({ revision: 1 }));
    await slow;
    expect(state.snapshot.value?.containerId).toBe('c2');
    expect(state.snapshot.value?.revision).toBe(9);
    expect(state.loading.value).toBe(false);
  });

  it('discards a failed load for a container that is no longer selected', async () => {
    let fail!: (reason: Error) => void;
    vi.mocked(getLabelOverrides).mockReturnValueOnce(
      new Promise<LabelOverrideSnapshot>((_, reject) => {
        fail = reject;
      }),
    );
    const id = ref('c1');
    const state = useLabelOverrides(id);
    const pending = state.load();
    id.value = 'c2';
    vi.mocked(getLabelOverrides).mockResolvedValueOnce(snapshot({ containerId: 'c2' }));
    await state.load();
    fail(new Error('late'));
    await pending;
    expect(state.loadError.value).toBe('');
    expect(state.snapshot.value?.containerId).toBe('c2');
  });

  it('clears the previous container while a different one loads', async () => {
    const next = deferred<LabelOverrideSnapshot>();
    vi.mocked(getLabelOverrides)
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(next.promise);
    const id = ref('c1');
    const state = useLabelOverrides(id);
    await state.load();
    id.value = 'c2';
    const pending = state.load();
    expect(state.snapshot.value).toBeNull();
    next.resolve(snapshot({ containerId: 'c2' }));
    await pending;
    expect(state.snapshot.value?.containerId).toBe('c2');
  });

  it('keeps the visible snapshot while reloading the same container', async () => {
    const next = deferred<LabelOverrideSnapshot>();
    vi.mocked(getLabelOverrides)
      .mockResolvedValueOnce(snapshot())
      .mockReturnValueOnce(next.promise);
    const state = useLabelOverrides(ref('c1'));
    await state.load();
    const pending = state.load();
    expect(state.snapshot.value).not.toBeNull();
    next.resolve(snapshot({ revision: 5 }));
    await pending;
    expect(state.snapshot.value?.revision).toBe(5);
  });

  describe('writes', () => {
    async function loaded(revision = 2, overrideId: string | null = 'o1') {
      vi.mocked(getLabelOverrides).mockResolvedValue(snapshot({ revision, overrideId }));
      const id = ref('c1');
      const state = useLabelOverrides(id);
      await state.load();
      return { state, id };
    }

    it('saves one field with the current revision and override id', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockResolvedValue(write());
      const pending = state.saveField('displayName', 'TV');
      expect(state.saving.value).toBe(true);
      await expect(pending).resolves.toEqual({ ok: true, changed: ['displayName'] });
      expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
        revision: 2,
        overrideId: 'o1',
        changes: [{ field: 'displayName', op: 'set', value: 'TV' }],
      });
      expect(state.snapshot.value?.revision).toBe(3);
      expect(state.saving.value).toBe(false);
    });

    it('resets one field with a remove change', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockResolvedValue(write());
      await state.resetField('displayIcon');
      expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
        revision: 2,
        overrideId: 'o1',
        changes: [{ field: 'displayIcon', op: 'remove' }],
      });
    });

    it('resets everything through the delete route', async () => {
      const { state } = await loaded();
      vi.mocked(resetLabelOverrides).mockResolvedValue(write({ revision: 0, overrideId: null }));
      await expect(state.resetAll()).resolves.toEqual({ ok: true, changed: ['displayName'] });
      expect(resetLabelOverrides).toHaveBeenCalledWith('c1', 2, 'o1');
      expect(state.snapshot.value?.revision).toBe(0);
    });

    it('does nothing without a snapshot or while a write is running', async () => {
      const state = useLabelOverrides(ref('c1'));
      await expect(state.saveField('displayName', 'x')).resolves.toBeUndefined();
      await expect(state.resetAll()).resolves.toBeUndefined();
      const { state: busy } = await loaded();
      const slow = deferred<ReturnType<typeof write>>();
      vi.mocked(patchLabelOverrides).mockReturnValueOnce(slow.promise);
      const first = busy.saveField('displayName', 'a');
      await expect(busy.saveField('displayName', 'b')).resolves.toBeUndefined();
      slow.resolve(write());
      await first;
      expect(patchLabelOverrides).toHaveBeenCalledTimes(1);
    });

    it('keeps the old snapshot on a stale revision and asks for a reload', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockRejectedValue(
        new LabelOverrideHttpError(409, 'stale', { snapshot: snapshot({ revision: 7 }) }),
      );
      const outcome = await state.saveField('displayName', 'TV');
      expect(outcome).toMatchObject({ ok: false, failure: { kind: 'conflict' } });
      expect(state.needsReload.value).toBe(true);
      expect(state.snapshot.value?.revision).toBe(2);
      await expect(state.saveField('displayName', 'again')).resolves.toBeUndefined();
      await expect(state.resetField('displayName')).resolves.toBeUndefined();
      await expect(state.resetAll()).resolves.toBeUndefined();
      expect(patchLabelOverrides).toHaveBeenCalledTimes(1);
      vi.mocked(getLabelOverrides).mockResolvedValue(snapshot({ revision: 7 }));
      await state.load();
      expect(state.needsReload.value).toBe(false);
      expect(state.snapshot.value?.revision).toBe(7);
    });

    it('treats an unknown outcome as needing a reload', async () => {
      const { state } = await loaded();
      vi.mocked(resetLabelOverrides).mockRejectedValue(new Error('offline'));
      const outcome = await state.resetAll();
      expect(outcome).toMatchObject({ ok: false, failure: { kind: 'unknown' } });
      expect(state.needsReload.value).toBe(true);
    });

    it('keeps the form usable after a validation failure', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockRejectedValue(
        new LabelOverrideHttpError(400, 'bad', {
          errors: [{ field: 'displayIcon', code: 'invalid-icon' }],
        }),
      );
      await state.saveField('displayIcon', 'x');
      expect(state.needsReload.value).toBe(false);
      expect(state.writeForbidden.value).toBe(false);
      expect(state.saving.value).toBe(false);
    });

    it('marks the panel read only after a 403', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockRejectedValue(new LabelOverrideHttpError(403, 'no'));
      await state.saveField('displayName', 'TV');
      expect(state.writeForbidden.value).toBe(true);
      expect(state.readOnly.value).toBe(true);
    });

    it('marks a rollback container read only when the write says so', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockRejectedValue(
        new LabelOverrideHttpError(409, 'rollback', { readOnlyReason: 'rollback-container' }),
      );
      await state.saveField('displayName', 'TV');
      expect(state.readOnly.value).toBe(true);
      expect(state.writeForbidden.value).toBe(false);
    });

    it('switches to not overridable when a write says the container has no scope', async () => {
      const { state } = await loaded();
      vi.mocked(patchLabelOverrides).mockRejectedValue(new LabelOverrideHttpError(409, 'no scope'));
      await state.saveField('displayName', 'TV');
      expect(state.notOverridable.value).toBe('no scope');
    });

    it('discards a write result that arrives after the container changed', async () => {
      const { state, id } = await loaded();
      const slow = deferred<ReturnType<typeof write>>();
      vi.mocked(patchLabelOverrides).mockReturnValueOnce(slow.promise);
      const pending = state.saveField('displayName', 'TV');
      id.value = 'c2';
      slow.resolve(write());
      await expect(pending).resolves.toBeUndefined();
      expect(state.snapshot.value?.revision).toBe(2);
      expect(state.saving.value).toBe(false);
    });

    it('discards a write failure that arrives after the container changed', async () => {
      const { state, id } = await loaded();
      vi.mocked(patchLabelOverrides).mockImplementationOnce(async () => {
        id.value = 'c2';
        throw new LabelOverrideHttpError(403, 'no');
      });
      await expect(state.saveField('displayName', 'TV')).resolves.toBeUndefined();
      expect(state.writeForbidden.value).toBe(false);
    });

    it('starts a new container without the old container’s write state', async () => {
      const { state, id } = await loaded();
      vi.mocked(patchLabelOverrides).mockRejectedValue(new LabelOverrideHttpError(403, 'no'));
      await state.saveField('displayName', 'TV');
      id.value = 'c2';
      vi.mocked(getLabelOverrides).mockResolvedValue(snapshot({ containerId: 'c2' }));
      await state.load();
      expect(state.writeForbidden.value).toBe(false);
    });

    it('sends a null override id before a row exists', async () => {
      const { state } = await loaded(0, null);
      vi.mocked(patchLabelOverrides).mockResolvedValue(write());
      await state.saveField('displayName', 'TV');
      expect(patchLabelOverrides).toHaveBeenCalledWith('c1', {
        revision: 0,
        overrideId: null,
        changes: [{ field: 'displayName', op: 'set', value: 'TV' }],
      });
    });
  });
});
