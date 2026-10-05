import {
  buildGroupPolicyBody,
  draftFromPolicy,
  failureFromError,
  groupPolicyFailureField,
  isValidGroupName,
  isValidMinAgeDays,
  parseListText,
  useGroupPolicies,
  visibleGroupName,
} from '@/composables/useGroupPolicies';
import { getContainerGroups } from '@/services/container';
import {
  createGroupPolicy,
  deleteGroupPolicy,
  type GroupPolicy,
  GroupPolicyHttpError,
  listGroupPolicies,
  replaceGroupPolicy,
} from '@/services/group-policy';
import { getAllTriggers } from '@/services/trigger';

vi.mock('@/services/group-policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/group-policy')>()),
  listGroupPolicies: vi.fn(),
  createGroupPolicy: vi.fn(),
  replaceGroupPolicy: vi.fn(),
  deleteGroupPolicy: vi.fn(),
}));
vi.mock('@/services/container', () => ({ getContainerGroups: vi.fn() }));
vi.mock('@/services/trigger', () => ({ getAllTriggers: vi.fn() }));

function policy(overrides: Partial<GroupPolicy> = {}): GroupPolicy {
  return {
    id: 'p1',
    group: 'payments',
    revision: 2,
    updatePolicy: { maturityMode: 'mature' },
    actions: {},
    createdAt: '',
    createdBy: 'user:scott',
    updatedAt: '',
    updatedBy: 'user:scott',
    members: { count: 3, agents: [null, 'edge1'] },
    ...overrides,
  };
}

function group(name: string | null, containerCount: number) {
  return { name, containers: [], containerCount, updatesAvailable: 0 };
}

beforeEach(() => {
  vi.mocked(listGroupPolicies).mockReset().mockResolvedValue([]);
  vi.mocked(getContainerGroups).mockReset().mockResolvedValue([]);
  vi.mocked(getAllTriggers).mockReset().mockResolvedValue([]);
  vi.mocked(createGroupPolicy).mockReset();
  vi.mocked(replaceGroupPolicy).mockReset();
  vi.mocked(deleteGroupPolicy).mockReset();
});

describe('useGroupPolicies load', () => {
  it('merges groups with policies, skipping the ungrouped bucket', async () => {
    vi.mocked(listGroupPolicies).mockResolvedValue([
      policy(),
      policy({ id: 'p2', group: 'ghost', members: { count: 0, agents: [] } }),
    ]);
    vi.mocked(getContainerGroups).mockResolvedValue([
      group('zeta', 4),
      group(null, 9),
      group('payments', 3),
    ]);
    const state = useGroupPolicies();
    await state.load();
    expect(state.loading.value).toBe(false);
    expect(state.loadError.value).toBe('');
    expect(state.rows.value).toEqual([
      {
        group: 'ghost',
        policy: policy({ id: 'p2', group: 'ghost', members: { count: 0, agents: [] } }),
        memberCount: 0,
        agents: [],
      },
      { group: 'payments', policy: policy(), memberCount: 3, agents: [null, 'edge1'] },
      { group: 'zeta', policy: undefined, memberCount: 4, agents: [] },
    ]);
  });

  it('sorts exact names without folding case', async () => {
    vi.mocked(getContainerGroups).mockResolvedValue([group('b', 1), group('B', 1), group('a', 1)]);
    const state = useGroupPolicies();
    await state.load();
    expect(state.rows.value.map((row) => row.group)).toEqual(['B', 'a', 'b']);
  });

  it('suggests unique action triggers and ignores notification triggers', async () => {
    vi.mocked(getAllTriggers).mockResolvedValue([
      { id: 'docker.local', type: 'docker', name: 'local' },
      { id: 'docker.local', type: 'docker', name: 'local' },
      { id: 'command.backup', type: 'command', name: 'backup' },
      { id: 'slack.ops', type: 'slack', name: 'ops' },
    ] as never);
    const state = useGroupPolicies();
    await state.load();
    expect(state.triggerSuggestions.value).toEqual(['command.backup', 'docker.local']);
  });

  it('survives a trigger lookup failure', async () => {
    vi.mocked(getAllTriggers).mockRejectedValue(new Error('down'));
    const state = useGroupPolicies();
    await state.load();
    expect(state.loadError.value).toBe('');
    expect(state.triggerSuggestions.value).toEqual([]);
  });

  it('reports a load failure, clears rows and recovers on retry', async () => {
    vi.mocked(listGroupPolicies).mockRejectedValueOnce(new Error('boom'));
    const state = useGroupPolicies();
    await state.load();
    expect(state.loadError.value).toBe('boom');
    expect(state.rows.value).toEqual([]);
    vi.mocked(listGroupPolicies).mockResolvedValue([policy()]);
    await state.load();
    expect(state.loadError.value).toBe('');
    expect(state.rows.value).toHaveLength(1);
  });

  it('falls back to the translated message for a non-error rejection', async () => {
    vi.mocked(getContainerGroups).mockRejectedValueOnce(undefined);
    const state = useGroupPolicies();
    await state.load();
    expect(state.loadError.value).toBe('Failed to load group policies');
  });
});

describe('useGroupPolicies writes', () => {
  it('creates and reloads', async () => {
    vi.mocked(createGroupPolicy).mockResolvedValue({
      policy: policy(),
      applied: { members: 3 },
      warnings: ['w'],
    });
    const state = useGroupPolicies();
    const body = { updatePolicy: { maturityMode: 'mature' as const }, actions: {} };
    const outcome = await state.create('payments', body);
    expect(createGroupPolicy).toHaveBeenCalledWith('payments', body);
    expect(outcome).toEqual({ ok: true, members: 3, warnings: ['w'], changed: true });
    expect(listGroupPolicies).toHaveBeenCalledTimes(1);
    expect(state.saving.value).toBe(false);
  });

  it('replaces with the revision and reports a no-op', async () => {
    vi.mocked(replaceGroupPolicy).mockResolvedValue({
      changed: false,
      policy: policy(),
      applied: { members: 0 },
      warnings: [],
    });
    const state = useGroupPolicies();
    const body = { updatePolicy: {}, actions: { updateMode: 'manual' as const } };
    const outcome = await state.update(policy(), body);
    expect(replaceGroupPolicy).toHaveBeenCalledWith('p1', 2, body);
    expect(outcome).toEqual({ ok: true, members: 0, warnings: [], changed: false });
  });

  it('removes with the revision', async () => {
    vi.mocked(deleteGroupPolicy).mockResolvedValue({
      changed: true,
      policy: policy(),
      applied: { members: 3 },
      warnings: [],
    });
    const state = useGroupPolicies();
    const outcome = await state.remove(policy());
    expect(deleteGroupPolicy).toHaveBeenCalledWith('p1', 2);
    expect(outcome).toEqual({ ok: true, members: 3, warnings: [], changed: true });
  });

  it('returns a classified failure and does not reload', async () => {
    vi.mocked(replaceGroupPolicy).mockRejectedValue(new GroupPolicyHttpError(409, 'stale'));
    const state = useGroupPolicies();
    const outcome = await state.update(policy(), { updatePolicy: {}, actions: {} });
    expect(outcome).toEqual({
      ok: false,
      failure: { kind: 'conflict', message: 'stale', field: 'form' },
    });
    expect(listGroupPolicies).not.toHaveBeenCalled();
    expect(state.saving.value).toBe(false);
  });

  it('remembers that writes are forbidden', async () => {
    vi.mocked(deleteGroupPolicy).mockRejectedValue(new GroupPolicyHttpError(403, 'Forbidden'));
    const state = useGroupPolicies();
    expect(state.writeForbidden.value).toBe(false);
    const outcome = await state.remove(policy());
    expect(outcome).toMatchObject({ ok: false, failure: { kind: 'forbidden' } });
    expect(state.writeForbidden.value).toBe(true);
  });

  it('ignores a second write while one is running', async () => {
    let release: (value: never) => void = () => {};
    vi.mocked(createGroupPolicy).mockReturnValue(new Promise((resolve) => (release = resolve)));
    const state = useGroupPolicies();
    const body = { updatePolicy: { maturityMode: 'all' as const }, actions: {} };
    const first = state.create('a', body);
    const second = await state.create('a', body);
    expect(second).toMatchObject({ ok: false, failure: { kind: 'unknown' } });
    release({ policy: policy(), applied: { members: 0 }, warnings: [] } as never);
    await first;
    expect(createGroupPolicy).toHaveBeenCalledTimes(1);
  });
});

describe('failureFromError', () => {
  it('classifies by status and operation', () => {
    const http = (status: number, message = 'm') => new GroupPolicyHttpError(status, message);
    expect(
      failureFromError(http(400, 'Invalid group update policy: "maturityMinAgeDays" bad'), 'save'),
    ).toEqual({
      kind: 'validation',
      message: 'Invalid group update policy: "maturityMinAgeDays" bad',
      field: 'maturityMinAgeDays',
    });
    expect(failureFromError(http(409, "A policy for group 'x' already exists"), 'create')).toEqual({
      kind: 'exists',
      message: "A policy for group 'x' already exists",
      field: 'group',
    });
    expect(failureFromError(http(409), 'save')).toMatchObject({ kind: 'conflict', field: 'form' });
    expect(failureFromError(http(409), 'remove')).toMatchObject({ kind: 'conflict' });
    expect(failureFromError(http(401), 'save')).toMatchObject({ kind: 'forbidden' });
    expect(failureFromError(http(403), 'save')).toMatchObject({ kind: 'forbidden' });
    expect(failureFromError(http(404), 'save')).toMatchObject({ kind: 'notFound' });
    expect(failureFromError(http(500, 'x'), 'save')).toMatchObject({
      kind: 'unknown',
      message: 'x',
    });
  });

  it('keeps the message of a plain error and falls back for anything else', () => {
    expect(failureFromError(new Error('net'), 'save')).toEqual({
      kind: 'unknown',
      message: 'net',
      field: 'form',
    });
    expect(failureFromError('weird', 'save').message).toBe('weird');
    expect(failureFromError(undefined, 'save').message).toBe('Could not save the group policy');
  });
});

describe('groupPolicyFailureField', () => {
  it.each([
    ['Invalid group update policy: "maturityMode" must be one of [all, mature]', 'maturityMode'],
    ['Invalid group update policy: "maturityMinAgeDays" must be >= 1', 'maturityMinAgeDays'],
    ['Invalid group update policy: "skipTags[0]" is not allowed', 'skipTags'],
    ['Invalid group update policy: "skipDigests" must be an array', 'skipDigests'],
    [
      'Group policies can only restrict updates: updateMode must be "manual" or "notify"',
      'updateMode',
    ],
    ['Invalid group action rules: "updateMode" must be one of [manual, notify]', 'updateMode'],
    ['Invalid group action rules: "a,b" is not a trigger reference. Use a trigger id', 'exclude'],
    ['Invalid group action rules: "exclude[0]" is not allowed to be empty', 'exclude'],
    ['A group name must be a non-empty string', 'group'],
    ['A group policy must set at least one field', 'form'],
    ['something else', 'form'],
  ])('maps %s to %s', (message, field) => {
    expect(groupPolicyFailureField(message)).toBe(field);
  });
});

describe('draft helpers', () => {
  it('shows whitespace at the edges of a name and nowhere else', () => {
    expect(visibleGroupName('payments')).toBe('payments');
    expect(visibleGroupName('  a b \t')).toBe('␣␣a b␣␣');
    expect(visibleGroupName(' ')).toBe('␣');
  });

  it('validates names and min age', () => {
    expect(isValidGroupName('a')).toBe(true);
    expect(isValidGroupName('   ')).toBe(false);
    expect(isValidGroupName('')).toBe(false);
    expect(isValidMinAgeDays('')).toBe(true);
    expect(isValidMinAgeDays(' ')).toBe(true);
    expect(isValidMinAgeDays('1')).toBe(true);
    expect(isValidMinAgeDays('365')).toBe(true);
    expect(isValidMinAgeDays('0')).toBe(false);
    expect(isValidMinAgeDays('366')).toBe(false);
    expect(isValidMinAgeDays('1.5')).toBe(false);
    expect(isValidMinAgeDays('x')).toBe(false);
  });

  it('parses lists from lines and commas, trimmed and unique', () => {
    expect(parseListText(' a, b\n\nb\n c ,')).toEqual(['a', 'b', 'c']);
    expect(parseListText('')).toEqual([]);
  });

  it('builds a draft from a policy and back to the same body', () => {
    const existing = policy({
      updatePolicy: {
        maturityMode: 'all',
        maturityMinAgeDays: 7,
        skipTags: ['1.0', '2.0'],
        skipDigests: ['sha256:a'],
      },
      actions: { updateMode: 'notify', exclude: ['docker.local:major'] },
    });
    const draft = draftFromPolicy(existing);
    expect(draft).toEqual({
      maturityMode: 'all',
      minAgeDays: '7',
      skipTags: '1.0\n2.0',
      skipDigests: 'sha256:a',
      updateMode: 'notify',
      exclude: 'docker.local:major',
    });
    expect(buildGroupPolicyBody(draft)).toEqual({
      updatePolicy: existing.updatePolicy,
      actions: existing.actions,
    });
  });

  it('builds an empty draft and body without a policy', () => {
    const draft = draftFromPolicy(undefined);
    expect(draft).toEqual({
      maturityMode: '',
      minAgeDays: '',
      skipTags: '',
      skipDigests: '',
      updateMode: '',
      exclude: '',
    });
    expect(buildGroupPolicyBody(draft)).toEqual({ updatePolicy: {}, actions: {} });
  });
});
