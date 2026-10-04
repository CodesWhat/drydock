import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as event from '../event/index.js';
import type { Container, ContainerUpdatePolicyDeclarative } from '../model/container.js';
import {
  applyDeclarativeUpdatePolicy,
  applyUpdatePolicyOverrides,
} from '../model/update-policy.js';
import { createContainerFixture } from '../test/helpers.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import * as container from './container.js';
import { type Database, openDatabase } from './db/driver.js';
import * as groupPolicy from './group-policy.js';

vi.mock('../event');

let db: Database;

beforeEach(() => {
  vi.resetAllMocks();
  container._resetContainerStoreStateForTests();
  db = createMigratedMemoryDatabase();
  container.createCollections(db);
  groupPolicy.createCollections(db);
});

afterEach(() => {
  groupPolicy.clearCollectionForTesting();
  db.close();
});

const COMPOSE_PAYMENTS = { 'com.docker.compose.project': 'payments' };
const NO_LAYERS: ContainerUpdatePolicyDeclarative = { env: {}, label: {} };

/** A container the way the Docker watcher hands it to the store: layers already resolved. */
function watched(
  id: string,
  overrides: Record<string, unknown> = {},
  declarative: ContainerUpdatePolicyDeclarative = NO_LAYERS,
) {
  const built = createContainerFixture({
    id,
    name: id,
    watcher: 'local',
    labels: COMPOSE_PAYMENTS,
    ...overrides,
  }) as unknown as Container;
  return applyDeclarativeUpdatePolicy(built, declarative);
}

function setPolicy(group: string, updatePolicy: object, actions?: object) {
  return groupPolicy.insertGroupPolicy(group, { updatePolicy, actions }, 'user:admin');
}

/** Write a row straight into the table, the way a record already on disk arrives. */
function seedRow(rawContainer: unknown) {
  const row = container.buildImportedContainerRow(rawContainer);
  if (!row) {
    throw new Error('seed failed validation');
  }
  container.insertImportedContainerRow(db, row);
}

function storedRow(id: string) {
  return db
    .prepare(
      'SELECT update_available, maturity_gate_pending_since, update_policy, update_policy_sources, group_policy FROM containers WHERE id = ?',
    )
    .get(id);
}

/** Everything but the policy fields, so an update carries only what the caller changed. */
function withoutPolicyFields(stored: Container) {
  const {
    updatePolicy: _updatePolicy,
    updatePolicyDeclarative: _declarative,
    updatePolicyOverrides: _overrides,
    updatePolicySources: _sources,
    groupPolicy: _groupPolicy,
    ...rest
  } = stored;
  return rest;
}

describe('group update-policy layer at the store', () => {
  test('a member of a group whose policy sets maturityMode mature resolves mature with source group', () => {
    const policy = setPolicy('payments', { maturityMode: 'mature' });

    const inserted = container.insertContainer(watched('member', { result: { tag: 'candidate' } }));

    expect(inserted.updatePolicy).toEqual({ maturityMode: 'mature' });
    expect(inserted.updatePolicySources).toEqual({ maturityMode: 'group' });
    expect(inserted.groupPolicy).toEqual({
      id: policy.id,
      group: 'payments',
      revision: 1,
      updatePolicy: { maturityMode: 'mature' },
      actions: {},
    });
    // The suppression getter and the derived columns see the final, group-layered policy.
    expect(inserted.updateAvailable).toBe(false);
    expect(storedRow('member')).toEqual({
      update_available: 0,
      maturity_gate_pending_since: expect.any(String),
      update_policy: '{"maturityMode":"mature"}',
      update_policy_sources: '{"maturityMode":"group"}',
      group_policy: JSON.stringify(inserted.groupPolicy),
    });
    expect(container.getContainer('member')?.groupPolicy).toEqual(inserted.groupPolicy);
  });

  test.each([
    [
      'a group beats the watcher env default',
      { env: { maturityMode: 'mature' }, label: {} },
      { maturityMode: 'all' },
      {},
      { maturityMode: 'all' },
      { maturityMode: 'group' },
    ],
    [
      'a label beats the group',
      { env: {}, label: { maturityMode: 'all' } },
      { maturityMode: 'mature' },
      {},
      { maturityMode: 'all' },
      { maturityMode: 'label' },
    ],
    [
      'an explicit empty override beats a group list',
      NO_LAYERS,
      { skipTags: ['a'] },
      { skipTags: [] },
      { skipTags: [] },
      { skipTags: 'override' },
    ],
  ])('%s', (_case, declarative, groupLayer, overrides, effective, sources) => {
    setPolicy('payments', groupLayer);
    const member = watched('member', {}, declarative as ContainerUpdatePolicyDeclarative);
    applyUpdatePolicyOverrides(member, overrides);

    const inserted = container.insertContainer(member);

    expect(inserted.updatePolicy).toEqual(effective);
    expect(inserted.updatePolicySources).toEqual(sources);
  });

  test('ignores an incoming snapshot and provisional policy and re-derives both', () => {
    const forged = watched('member', { labels: {} });
    Object.assign(forged, {
      groupPolicy: {
        id: 'forged',
        group: 'payments',
        revision: 9,
        updatePolicy: { maturityMode: 'mature' },
        actions: {},
      },
      updatePolicy: { maturityMode: 'mature' },
      updatePolicySources: { maturityMode: 'group' },
    });

    const inserted = container.insertContainer(forged);

    expect(inserted).not.toHaveProperty('groupPolicy');
    expect(inserted.updatePolicy).toBeUndefined();
    expect(inserted.updatePolicySources).toEqual({});

    const policy = setPolicy('billing', { skipDigests: ['sha256:a'] });
    const stale = { ...container.getContainerRaw('member'), labels: { 'dd.group': 'billing' } };
    Object.assign(stale, { groupPolicy: { ...policy, revision: 7, updatePolicy: {} } });

    expect(container.updateContainer(stale).groupPolicy).toMatchObject({
      id: policy.id,
      revision: 1,
      updatePolicy: { skipDigests: ['sha256:a'] },
    });
  });

  test.each([
    [
      'an empty dd.group, which does not fall through to the Compose project,',
      { 'dd.group': '', ...COMPOSE_PAYMENTS },
    ],
    ['an ungrouped container', {}],
  ])('%s carries no policy', (_case, labels) => {
    setPolicy('payments', { maturityMode: 'mature' });

    const inserted = container.insertContainer(watched('member', { labels }));

    expect(inserted).not.toHaveProperty('groupPolicy');
    expect(inserted.updatePolicy).toBeUndefined();
  });

  test('a label-only update joins a group and a later one leaves it', () => {
    setPolicy('payments', { maturityMode: 'mature' });
    container.insertContainer(watched('member', { labels: {} }));

    const joined = container.updateContainer({
      ...withoutPolicyFields(container.getContainerRaw('member')),
      labels: { 'dd.group': 'payments' },
    });
    expect(joined.updatePolicy).toEqual({ maturityMode: 'mature' });
    expect(joined.groupPolicy?.group).toBe('payments');

    const left = container.updateContainer({
      ...withoutPolicyFields(container.getContainerRaw('member')),
      labels: { 'dd.group': 'elsewhere' },
    });
    expect(left.updatePolicy).toBeUndefined();
    expect(left.updatePolicySources).toEqual({});
    expect(left).not.toHaveProperty('groupPolicy');
    expect(storedRow('member')).toMatchObject({ group_policy: null });
  });

  test('a declarative update re-applies the group layer on top of the new labels', () => {
    setPolicy('payments', { maturityMode: 'mature', skipTags: ['group'] });
    container.insertContainer(watched('member'));

    const updated = container.updateContainer(
      watched('member', {}, { env: {}, label: { skipTags: ['label'] } }),
    );

    expect(updated.updatePolicy).toEqual({ maturityMode: 'mature', skipTags: ['label'] });
    expect(updated.updatePolicySources).toEqual({ maturityMode: 'group', skipTags: 'label' });
  });

  test('a field patch that changes labels joins and leaves the group', () => {
    setPolicy('billing', { skipTags: ['1.0.0'] });
    container.insertContainer(watched('member'));

    expect(
      container.updateContainerFields('member', { labels: { 'dd.group': 'billing' } })
        ?.updatePolicy,
    ).toEqual({ skipTags: ['1.0.0'] });
    const left = container.updateContainerFields('member', { labels: {} });
    expect(left?.updatePolicy).toBeUndefined();
    expect(left).not.toHaveProperty('groupPolicy');
  });

  test('a legacy record is converted first, so a group added then deleted restores its own values', () => {
    seedRow(
      createContainerFixture({
        id: 'legacy',
        name: 'legacy',
        watcher: 'local',
        labels: COMPOSE_PAYMENTS,
        updatePolicy: { skipTags: ['legacy'], maturityMinAgeDays: 3 },
      }),
    );
    const policy = setPolicy('payments', { maturityMode: 'mature', skipTags: ['group'] });

    expect(container.reResolveGroupPolicyMembers('payments').reResolved).toBe(1);
    expect(container.getContainerRaw('legacy')).toMatchObject({
      updatePolicy: { maturityMode: 'mature', skipTags: ['legacy'], maturityMinAgeDays: 3 },
      updatePolicyDeclarative: { env: {}, label: {} },
      updatePolicyOverrides: { skipTags: ['legacy'], maturityMinAgeDays: 3 },
      updatePolicySources: {
        maturityMode: 'group',
        skipTags: 'override',
        maturityMinAgeDays: 'override',
      },
    });

    groupPolicy.deleteGroupPolicy(policy.id, 1);
    container.reResolveGroupPolicyMembers('payments');

    const restored = container.getContainerRaw('legacy');
    expect(restored?.updatePolicy).toEqual({ skipTags: ['legacy'], maturityMinAgeDays: 3 });
    expect(restored?.updatePolicySources).toEqual({
      skipTags: 'override',
      maturityMinAgeDays: 'override',
    });
    expect(restored).not.toHaveProperty('groupPolicy');
  });

  test('an actions-only policy change still announces the container as updated', () => {
    const policy = setPolicy('payments', { maturityMode: 'mature' }, { updateMode: 'manual' });
    const before = container.insertContainer(watched('member'));
    const emitted = vi.mocked(event.emitContainerUpdated);
    emitted.mockClear();

    container.reResolveGroupPolicyMembers('payments');
    expect(emitted).not.toHaveBeenCalled();

    groupPolicy.replaceGroupPolicy(
      policy.id,
      1,
      { updatePolicy: { maturityMode: 'mature' }, actions: { updateMode: 'notify' } },
      'user:admin',
    );
    container.reResolveGroupPolicyMembers('payments');

    const after = container.getContainerRaw('member') as Container;
    expect(after.updatePolicy).toEqual(before.updatePolicy);
    expect(after.groupPolicy).toMatchObject({ revision: 2, actions: { updateMode: 'notify' } });
    expect(container.hasContainerChanged(before, after)).toBe(true);
    expect(emitted).toHaveBeenCalledTimes(1);
  });
});

describe('membership changes, recreation and the stash', () => {
  function memberWithOverride(id: string, labels: Record<string, string> = COMPOSE_PAYMENTS) {
    const member = watched(id, { name: 'service', labels });
    applyUpdatePolicyOverrides(member, { maturityMinAgeDays: 3 });
    return member;
  }

  test('the stash holds only the overrides of a container that carried a group layer', () => {
    setPolicy('payments', { maturityMode: 'mature', skipTags: ['group'] });
    container.insertContainer(memberWithOverride('old'));

    container.deleteContainer('old', { replacementExpected: true });

    expect([...container._getUpdatePolicyRetentionCacheForTests().values()]).toEqual([
      expect.objectContaining({ updatePolicyOverrides: { maturityMinAgeDays: 3 } }),
    ]);
  });

  test.each([
    [
      'the same group',
      COMPOSE_PAYMENTS,
      { maturityMode: 'mature', skipTags: ['group'], maturityMinAgeDays: 3 },
      'payments',
    ],
    [
      'a different group',
      { 'dd.group': 'billing' },
      { skipDigests: ['sha256:billing'], maturityMinAgeDays: 3 },
      'billing',
    ],
    ['no group', {}, { maturityMinAgeDays: 3 }, undefined],
  ])(
    'a recreate into %s gets that layer plus the retained overrides',
    (_case, labels, effective, group) => {
      setPolicy('payments', { maturityMode: 'mature', skipTags: ['group'] });
      setPolicy('billing', { skipDigests: ['sha256:billing'] });
      container.insertContainer(memberWithOverride('old'));
      container.deleteContainer('old', { replacementExpected: true });

      const recreated = container.insertContainer(watched('new', { name: 'service', labels }));

      expect(recreated.updatePolicyOverrides).toEqual({ maturityMinAgeDays: 3 });
      expect(recreated.updatePolicy).toEqual(effective);
      expect(recreated.groupPolicy?.group).toBe(group);
    },
  );

  test('an agent-owned replacement adopts only the overrides of its still-stored predecessor', () => {
    setPolicy('payments', { maturityMode: 'mature', skipTags: ['group'] });
    container.insertContainer(
      Object.assign(memberWithOverride('old'), { agent: 'edge1' }) as Container,
    );

    const replacement = container.insertContainer(
      watched('new', { name: 'service', agent: 'edge1', labels: {} }),
    );

    expect(replacement.updatePolicyOverrides).toEqual({ maturityMinAgeDays: 3 });
    expect(replacement.updatePolicy).toEqual({ maturityMinAgeDays: 3 });
    expect(replacement).not.toHaveProperty('groupPolicy');
  });

  test('every replica of a Compose service gets the layer, and one replica override stays its own', () => {
    setPolicy('payments', { maturityMode: 'mature' });
    const labels = { ...COMPOSE_PAYMENTS, 'com.docker.compose.service': 'web' };
    container.insertContainer(memberWithOverride('replica-1', labels));
    container.insertContainer(watched('replica-2', { labels }));

    expect(container.getContainerRaw('replica-1')?.updatePolicy).toEqual({
      maturityMode: 'mature',
      maturityMinAgeDays: 3,
    });
    expect(container.getContainerRaw('replica-2')?.updatePolicy).toEqual({
      maturityMode: 'mature',
    });
  });
});

describe('reResolveGroupPolicyMembers', () => {
  test('reports a member that throws something other than an Error', () => {
    container.insertContainer(watched('member'));
    setPolicy('payments', { maturityMode: 'mature' });
    vi.mocked(event.emitContainerUpdated).mockImplementationOnce(() => {
      throw 'plain string failure';
    });

    expect(container.reResolveGroupPolicyMembers('payments')).toEqual({
      reResolved: 0,
      failed: [{ id: 'member', error: 'plain string failure' }],
    });
  });

  test('continues past a member that fails and reports it', () => {
    container.insertContainer(watched('first'));
    container.insertContainer(watched('second'));
    container.insertContainer(watched('third'));
    setPolicy('payments', { maturityMode: 'mature' });
    vi.mocked(event.emitContainerUpdated).mockClear();
    vi.mocked(event.emitContainerUpdated).mockImplementationOnce(() => {
      throw new Error('listener exploded');
    });

    const result = container.reResolveGroupPolicyMembers('payments');

    expect(result.reResolved + result.failed.length).toBe(3);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toMatch(/^(first|second|third)$/);
    expect(result.failed[0].error).toBe('listener exploded');
    for (const id of ['first', 'second', 'third']) {
      expect(container.getContainerRaw(id)?.updatePolicySources).toEqual({ maturityMode: 'group' });
    }
  });

  test('re-resolves every member on the controller and on each agent before it returns', () => {
    container.insertContainer(watched('controller-member'));
    container.insertContainer(watched('edge1-member', { agent: 'edge1' }));
    container.insertContainer(watched('edge2-member', { agent: 'edge2' }));
    container.insertContainer(watched('outsider', { labels: { 'dd.group': 'billing' } }));
    setPolicy('payments', { maturityMode: 'mature' });

    const result = container.reResolveGroupPolicyMembers('payments');

    expect(result).toEqual({ reResolved: 3, failed: [] });
    for (const id of ['controller-member', 'edge1-member', 'edge2-member']) {
      expect(container.getContainerRaw(id)?.updatePolicySources).toEqual({ maturityMode: 'group' });
    }
    expect(container.getContainerRaw('outsider')).not.toHaveProperty('groupPolicy');
  });

  test('also reaches a container whose stored snapshot names the group its labels left', () => {
    const policy = setPolicy('payments', { maturityMode: 'mature' });
    container.insertContainer(watched('member'));
    db.prepare('UPDATE containers SET labels = ? WHERE id = ?').run('{}', 'member');
    groupPolicy.deleteGroupPolicy(policy.id, 1);

    expect(container.reResolveGroupPolicyMembers('payments').reResolved).toBe(1);
    expect(container.getContainerRaw('member')).not.toHaveProperty('groupPolicy');
  });
});

describe('reconcileGroupPolicySnapshots', () => {
  test('does nothing when no policy applies and nothing carries a group layer', () => {
    container.insertContainer(watched('member'));
    const before = storedRow('member');
    vi.mocked(event.emitContainerUpdated).mockClear();

    expect(container.reconcileGroupPolicySnapshots()).toBe(0);

    expect(storedRow('member')).toEqual(before);
    expect(event.emitContainerUpdated).not.toHaveBeenCalled();
  });

  test('leaves members that already carry the current policy alone', () => {
    setPolicy('payments', { maturityMode: 'mature' });
    container.insertContainer(watched('member'));

    expect(container.reconcileGroupPolicySnapshots()).toBe(0);
  });

  test('heals members a crash left on the previous revision', () => {
    const policy = setPolicy('payments', { maturityMode: 'mature' });
    container.insertContainer(watched('member'));
    groupPolicy.replaceGroupPolicy(policy.id, 1, { updatePolicy: { skipTags: ['x'] } }, 'u');

    expect(container.reconcileGroupPolicySnapshots()).toBe(1);
    expect(container.getContainerRaw('member')).toMatchObject({
      updatePolicy: { skipTags: ['x'] },
      groupPolicy: { revision: 2 },
    });
  });

  test('heals members a crash left carrying a deleted policy', () => {
    const policy = setPolicy('payments', { maturityMode: 'mature' });
    container.insertContainer(watched('member'));
    groupPolicy.deleteGroupPolicy(policy.id, 1);

    expect(container.reconcileGroupPolicySnapshots()).toBe(1);
    expect(container.getContainerRaw('member')).not.toHaveProperty('groupPolicy');
    expect(container.getContainerRaw('member')?.updatePolicy).toBeUndefined();
  });

  test('heals the drift a pre-group-policy build leaves behind', () => {
    setPolicy('payments', { maturityMode: 'mature' });
    container.insertContainer(watched('member'));
    // An older build rewrites the policy columns it knows and never touches group_policy.
    db.prepare(
      "UPDATE containers SET update_policy = NULL, update_policy_sources = '{}' WHERE id = ?",
    ).run('member');

    expect(container.reconcileGroupPolicySnapshots()).toBe(1);
    expect(storedRow('member')).toMatchObject({
      update_policy: '{"maturityMode":"mature"}',
      update_policy_sources: '{"maturityMode":"group"}',
    });
  });

  test('converts a legacy member no write has reached yet, and skips ungrouped records', () => {
    setPolicy('payments', { maturityMode: 'mature' });
    seedRow(
      createContainerFixture({
        id: 'legacy',
        name: 'legacy',
        watcher: 'local',
        labels: COMPOSE_PAYMENTS,
        updatePolicy: { skipTags: ['legacy'] },
      }),
    );
    seedRow(createContainerFixture({ id: 'ungrouped', name: 'ungrouped', watcher: 'local' }));
    const ungroupedBefore = storedRow('ungrouped');

    expect(container.reconcileGroupPolicySnapshots()).toBe(1);
    expect(container.getContainerRaw('legacy')).toMatchObject({
      updatePolicy: { maturityMode: 'mature', skipTags: ['legacy'] },
      updatePolicyOverrides: { skipTags: ['legacy'] },
      updatePolicySources: { maturityMode: 'group', skipTags: 'override' },
    });
    expect(storedRow('ungrouped')).toEqual(ungroupedBefore);
  });
});

const GOLDEN_ENV_KEYS = ['DD_STORE_PATH', 'DD_STORE_FILE', 'DD_VERSION'] as const;
const GOLDEN_FIXTURE_PATH = path.resolve(__dirname, './fixtures/dd-v1.7.json');
const GOLDEN_NOW = new Date('2026-10-01T12:00:00.000Z');

/**
 * Every `containers` column that existed before group policies (migrations 1-6). The
 * golden below was captured from these columns on the code as it stood before the group
 * layer was added, so it pins what a store with zero group policies writes.
 */
const PRE_GROUP_POLICY_CONTAINER_COLUMNS = [
  'id',
  'identity_key',
  'name',
  'display_name',
  'display_icon',
  'status',
  'health',
  'watcher',
  'agent',
  'update_available',
  'update_kind',
  'update_detected_at',
  'first_seen_at',
  'maturity_gate_pending_since',
  'image_name',
  'image_tag_value',
  'image_digest_value',
  'error_message',
  'security_state_hash',
  'image',
  'result',
  'update_kind_detail',
  'security',
  'update_policy',
  'update_policy_declarative',
  'update_policy_overrides',
  'update_policy_sources',
  'update_rollback',
  'details',
  'labels',
  'link_config',
  'tag_config',
  'trigger_config',
  'source_repo',
  'current_release_notes',
];

describe('zero group policies (golden)', () => {
  test('a v1.7 import and a representative write sequence store exactly the pre-group-policy rows', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-group-policy-golden-'));
    const previousEnv = Object.fromEntries(GOLDEN_ENV_KEYS.map((key) => [key, process.env[key]]));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(GOLDEN_NOW);

    try {
      process.env.DD_STORE_PATH = tempDir;
      process.env.DD_STORE_FILE = 'dd.json';
      process.env.DD_VERSION = '1.8.0';
      fs.copyFileSync(GOLDEN_FIXTURE_PATH, path.join(tempDir, 'dd.json'));
      vi.resetModules();

      const store = await import('./index.js');
      const container = await import('./container.js');
      await store.init();

      // A legacy record (flat updatePolicy, no declarative layer) written back unchanged.
      container.updateContainer(container.getContainerRaw('container-full-app'));

      // A label-only patch that moves a container into a group no policy names.
      container.updateContainerFields('container-cache-web', {
        status: 'exited',
        labels: { 'dd.group': 'payments' },
      });

      // A watcher insert in a Compose project, with env and label layers.
      const composeMember = createContainerFixture({
        id: 'golden-compose-one',
        name: 'golden-compose',
        watcher: 'local',
        labels: { 'com.docker.compose.project': 'payments' },
      });
      applyDeclarativeUpdatePolicy(composeMember as never, {
        env: { maturityMode: 'mature' },
        label: { skipTags: ['9.9.9'] },
      });
      container.insertContainer(composeMember);

      // An override written the way the update-policy PATCH handler writes one.
      const overridden = container.getContainerRaw('golden-compose-one');
      applyUpdatePolicyOverrides(overridden as never, { maturityMinAgeDays: 3 });
      container.updateContainer(overridden, { authoritativeEmptyOverrides: true });

      // A recreate: the override is stashed and restored onto the new id.
      container.deleteContainer('golden-compose-one', { replacementExpected: true });
      const recreated = createContainerFixture({
        id: 'golden-compose-two',
        name: 'golden-compose',
        watcher: 'local',
        labels: { 'com.docker.compose.project': 'payments' },
      });
      applyDeclarativeUpdatePolicy(recreated as never, {
        env: { maturityMode: 'mature' },
        label: { skipTags: ['9.9.9'] },
      });
      container.insertContainer(recreated);

      // An agent-owned insert, normalized the way agent inventory normalizes one.
      const agentOwned = createContainerFixture({
        id: 'golden-agent',
        name: 'golden-agent',
        watcher: 'local',
        agent: 'edge-one',
        labels: { 'dd.group': 'payments' },
      });
      applyUpdatePolicyOverrides(agentOwned as never, {});
      container.insertContainer(agentOwned);

      await store.save();
      const database = openDatabase(path.join(tempDir, 'dd.sqlite'), { readOnly: true });
      try {
        const rows = database
          .prepare(
            `SELECT ${PRE_GROUP_POLICY_CONTAINER_COLUMNS.join(', ')} FROM containers ORDER BY id`,
          )
          .all();
        expect(rows).toMatchInlineSnapshot(`
          [
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "cache-web",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "container-cache-web",
              "identity_key": "::local::cache-web",
              "image": "{"id":"image-id-cache-web","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/web","tag":{"value":"one","semver":false,"tagPrecision":"floating"},"digest":{"watch":false},"architecture":"amd64","os":"linux"}",
              "image_digest_value": null,
              "image_name": "library/web",
              "image_tag_value": "one",
              "labels": "{"dd.group":"payments"}",
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "cache-web",
              "result": "{"tag":"one"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "exited",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "local",
            },
            {
              "agent": "edge-one",
              "current_release_notes": null,
              "details": "{"ports":["8080/tcp"],"volumes":["/data"],"env":[{"key":"NODE_ENV","value":"production"}]}",
              "display_icon": "mdi:docker",
              "display_name": "Full App",
              "error_message": null,
              "first_seen_at": "2026-10-01T12:00:00.000Z",
              "health": "healthy",
              "id": "container-full-app",
              "identity_key": "edge-one::local::full-app",
              "image": "{"id":"image-id-full-app","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/full-app","tag":{"value":"1.0.0","semver":true,"tagPrecision":"specific"},"digest":{"watch":true,"value":"digest-placeholder-full-app-one","repo":"library/full-app"},"architecture":"amd64","os":"linux"}",
              "image_digest_value": "digest-placeholder-full-app-one",
              "image_name": "library/full-app",
              "image_tag_value": "1.0.0",
              "labels": "{"dd.watch":"true"}",
              "link_config": "{"link":"https://links-fixture.test/full-app","linkTemplate":"https://links-fixture.test/full-app","portLabel":"8080"}",
              "maturity_gate_pending_since": "2026-10-01T12:00:00.000Z",
              "name": "full-app",
              "result": "{"tag":"1.1.0","digest":"digest-placeholder-full-app-two","created":"2026-01-11T00:00:00.000Z","link":"https://links-fixture.test/full-app"}",
              "security": "{"scan":{"scanner":"trivy","image":"library/full-app:1.0.0","scannedAt":"2026-01-08T00:00:00.000Z","status":"passed","blockSeverities":["CRITICAL"],"blockingCount":0,"summary":{"unknown":0,"low":1,"medium":0,"high":0,"critical":0},"vulnerabilities":[]}}",
              "security_state_hash": "9889fead21e54a412d07842a172ab21335ae966f3daf0ccf31dd81adb391f6b7",
              "source_repo": "library/full-app-source",
              "status": "running",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": "2026-10-01T12:00:00.000Z",
              "update_kind": "tag",
              "update_kind_detail": "{"kind":"tag","localValue":"1.0.0","remoteValue":"1.1.0","semverDiff":"minor"}",
              "update_policy": "{"maturityMode":"mature","maturityMinAgeDays":3}",
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "local",
            },
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "shared-svc",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "container-shared-svc-a",
              "identity_key": "::watcher-a::shared-svc",
              "image": "{"id":"image-id-shared-svc-a","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/shared","tag":{"value":"one","semver":false,"tagPrecision":"floating"},"digest":{"watch":false},"architecture":"amd64","os":"linux"}",
              "image_digest_value": null,
              "image_name": "library/shared",
              "image_tag_value": "one",
              "labels": null,
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "shared-svc",
              "result": "{"tag":"one"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "watcher-a",
            },
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "shared-svc",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "container-shared-svc-b",
              "identity_key": "::watcher-b::shared-svc",
              "image": "{"id":"image-id-shared-svc-b","registry":{"name":"hub","url":"https://registry-fixture.test"},"name":"library/shared","tag":{"value":"one","semver":false,"tagPrecision":"floating"},"digest":{"watch":false},"architecture":"amd64","os":"linux"}",
              "image_digest_value": null,
              "image_name": "library/shared",
              "image_tag_value": "one",
              "labels": null,
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "shared-svc",
              "result": "{"tag":"one"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": null,
              "update_policy_overrides": null,
              "update_policy_sources": null,
              "update_rollback": null,
              "watcher": "watcher-b",
            },
            {
              "agent": "edge-one",
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "golden-agent",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "golden-agent",
              "identity_key": "edge-one::local::golden-agent",
              "image": "{"id":"image-123456789","registry":{"name":"registry","url":"https://hub"},"name":"organization/image","tag":{"value":"version","semver":false},"digest":{"watch":false},"architecture":"arch","os":"os","created":"2021-06-12T05:33:38.440Z"}",
              "image_digest_value": null,
              "image_name": "organization/image",
              "image_tag_value": "version",
              "labels": "{"dd.group":"payments"}",
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "golden-agent",
              "result": "{"tag":"version"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": null,
              "update_policy_declarative": "{"env":{},"label":{}}",
              "update_policy_overrides": "{}",
              "update_policy_sources": "{}",
              "update_rollback": null,
              "watcher": "local",
            },
            {
              "agent": null,
              "current_release_notes": null,
              "details": null,
              "display_icon": "mdi:docker",
              "display_name": "golden-compose",
              "error_message": null,
              "first_seen_at": null,
              "health": null,
              "id": "golden-compose-two",
              "identity_key": "::local::golden-compose",
              "image": "{"id":"image-123456789","registry":{"name":"registry","url":"https://hub"},"name":"organization/image","tag":{"value":"version","semver":false},"digest":{"watch":false},"architecture":"arch","os":"os","created":"2021-06-12T05:33:38.440Z"}",
              "image_digest_value": null,
              "image_name": "organization/image",
              "image_tag_value": "version",
              "labels": "{"com.docker.compose.project":"payments"}",
              "link_config": "{}",
              "maturity_gate_pending_since": null,
              "name": "golden-compose",
              "result": "{"tag":"version"}",
              "security": null,
              "security_state_hash": "2b3909dbc97b1747d572c243b149e763dad0122482935e6f1e4a0ce09d06112d",
              "source_repo": null,
              "status": "unknown",
              "tag_config": "{}",
              "trigger_config": "{}",
              "update_available": 0,
              "update_detected_at": null,
              "update_kind": "unknown",
              "update_kind_detail": "{"kind":"unknown","semverDiff":"unknown"}",
              "update_policy": "{"maturityMode":"mature","skipTags":["9.9.9"],"maturityMinAgeDays":3}",
              "update_policy_declarative": "{"env":{"maturityMode":"mature"},"label":{"skipTags":["9.9.9"]}}",
              "update_policy_overrides": "{"maturityMinAgeDays":3}",
              "update_policy_sources": "{"maturityMode":"env","skipTags":"label","maturityMinAgeDays":"override"}",
              "update_rollback": null,
              "watcher": "local",
            },
          ]
        `);
        // The only new state is an empty table and a column nothing wrote.
        expect(
          database
            .prepare('SELECT COUNT(*) AS n FROM containers WHERE group_policy IS NOT NULL')
            .get(),
        ).toEqual({ n: 0 });
        expect(database.prepare('SELECT COUNT(*) AS n FROM group_policies').get()).toEqual({
          n: 0,
        });
      } finally {
        database.close();
      }
    } finally {
      vi.useRealTimers();
      GOLDEN_ENV_KEYS.forEach((key) => {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      fs.rmSync(tempDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
