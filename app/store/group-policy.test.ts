import { GroupPolicyValidationError } from '../model/group-policy.js';
import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import { type Database, StoreConstraintError } from './db/driver.js';
import * as groupPolicy from './group-policy.js';

let db: Database;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  db = createMigratedMemoryDatabase();
  groupPolicy.createCollections(db);
});

afterEach(() => {
  groupPolicy.clearCollectionForTesting();
  db.close();
  vi.useRealTimers();
});

function readRow(id: string) {
  return db.prepare('SELECT * FROM group_policies WHERE id = ?').get(id);
}

describe('before createCollections', () => {
  test('reads nothing and refuses to write', () => {
    groupPolicy.clearCollectionForTesting();

    expect(groupPolicy.getGroupPolicies()).toEqual([]);
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toBeUndefined();
    expect(() =>
      groupPolicy.insertGroupPolicy(
        'payments',
        { updatePolicy: { maturityMode: 'mature' } },
        'user:admin',
      ),
    ).toThrow('group policies collection not initialized');
  });
});

describe('insertGroupPolicy', () => {
  test('stores a normalized policy at revision 1 and serves it by group and by id', () => {
    const policy = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { skipTags: [' 1.0.0 '] }, actions: { updateMode: 'manual' } },
      'user:admin',
    );

    expect(policy).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      group: 'payments',
      revision: 1,
      updatePolicy: { skipTags: ['1.0.0'] },
      actions: { updateMode: 'manual' },
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: 'user:admin',
      updatedAt: '2026-10-01T00:00:00.000Z',
      updatedBy: 'user:admin',
    });
    expect(readRow(policy.id)).toEqual({
      id: policy.id,
      group_name: 'payments',
      revision: 1,
      update_policy: '{"skipTags":["1.0.0"]}',
      actions: '{"updateMode":"manual"}',
      created_at: '2026-10-01T00:00:00.000Z',
      created_by: 'user:admin',
      updated_at: '2026-10-01T00:00:00.000Z',
      updated_by: 'user:admin',
    });
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toEqual(policy);
    expect(groupPolicy.getGroupPolicyById(policy.id)).toEqual(policy);
  });

  test('stores an empty body as {}', () => {
    const policy = groupPolicy.insertGroupPolicy(
      'payments',
      { actions: { exclude: ['docker.local'] } },
      'api-key:abc',
    );

    expect(readRow(policy.id)).toMatchObject({
      update_policy: '{}',
      actions: '{"exclude":["docker.local"]}',
    });
  });

  test('matches the exact group name, with no trimming or case folding', () => {
    groupPolicy.insertGroupPolicy(
      ' Payments ',
      { updatePolicy: { maturityMode: 'mature' } },
      'user:admin',
    );

    expect(groupPolicy.getGroupPolicyForGroup(' Payments ')?.group).toBe(' Payments ');
    expect(groupPolicy.getGroupPolicyForGroup('Payments')).toBeUndefined();
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toBeUndefined();
  });

  test.each([
    ['an empty name', ''],
    ['a whitespace-only name', '  '],
  ])('rejects %s', (_case, group) => {
    expect(() =>
      groupPolicy.insertGroupPolicy(group, { updatePolicy: { maturityMode: 'all' } }, 'user:a'),
    ).toThrow(GroupPolicyValidationError);
    expect(groupPolicy.getGroupPolicies()).toEqual([]);
  });

  test('rejects an invalid or empty body without writing', () => {
    expect(() =>
      groupPolicy.insertGroupPolicy('payments', { actions: { updateMode: 'auto' } }, 'user:a'),
    ).toThrow(GroupPolicyValidationError);
    expect(() => groupPolicy.insertGroupPolicy('payments', {}, 'user:a')).toThrow(
      GroupPolicyValidationError,
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM group_policies').get()).toEqual({ n: 0 });
  });

  test('refuses a second policy for the same group and keeps the first', () => {
    const first = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'user:a',
    );

    expect(() =>
      groupPolicy.insertGroupPolicy('payments', { updatePolicy: { maturityMode: 'all' } }, 'u'),
    ).toThrow(StoreConstraintError);
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toEqual(first);
  });
});

describe('reads', () => {
  test('list every policy ordered by group name', () => {
    groupPolicy.insertGroupPolicy('web', { updatePolicy: { maturityMode: 'all' } }, 'u');
    groupPolicy.insertGroupPolicy('api', { updatePolicy: { maturityMode: 'all' } }, 'u');
    groupPolicy.insertGroupPolicy('db', { updatePolicy: { maturityMode: 'all' } }, 'u');

    expect(groupPolicy.getGroupPolicies().map((policy) => policy.group)).toEqual([
      'api',
      'db',
      'web',
    ]);
  });

  test('hand out copies the caller cannot use to change the cache', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { skipTags: ['1.0.0'] } },
      'u',
    );
    inserted.updatePolicy.skipTags?.push('inserted');
    groupPolicy.getGroupPolicyForGroup('payments')?.updatePolicy.skipTags?.push('by-group');
    groupPolicy.getGroupPolicyById(inserted.id)?.updatePolicy.skipTags?.push('by-id');
    groupPolicy.getGroupPolicies()[0].updatePolicy.skipTags?.push('listed');

    expect(groupPolicy.getGroupPolicyForGroup('payments')?.updatePolicy).toEqual({
      skipTags: ['1.0.0'],
    });
  });

  test('miss an unknown id', () => {
    expect(groupPolicy.getGroupPolicyById('missing')).toBeUndefined();
    groupPolicy.insertGroupPolicy('payments', { updatePolicy: { maturityMode: 'all' } }, 'u');
    expect(groupPolicy.getGroupPolicyById('missing')).toBeUndefined();
  });

  test('load what is already stored when the collection is created', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'u',
    );
    groupPolicy.clearCollectionForTesting();

    groupPolicy.createCollections(db);

    expect(groupPolicy.getGroupPolicyForGroup('payments')).toEqual(inserted);
  });
});

describe('replaceGroupPolicy', () => {
  test('bumps the revision and replaces both bodies when the expected revision matches', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' }, actions: { updateMode: 'notify' } },
      'user:admin',
    );
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));

    const replaced = groupPolicy.replaceGroupPolicy(
      inserted.id,
      1,
      { updatePolicy: { maturityMinAgeDays: 9 } },
      'api-key:abc',
    );

    expect(replaced).toEqual({
      ...inserted,
      revision: 2,
      updatePolicy: { maturityMinAgeDays: 9 },
      actions: {},
      updatedAt: '2026-10-02T00:00:00.000Z',
      updatedBy: 'api-key:abc',
    });
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toEqual(replaced);
    expect(readRow(inserted.id)).toMatchObject({ revision: 2, actions: '{}' });
  });

  test('changes nothing for a stale revision or an unknown id', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'u',
    );
    groupPolicy.replaceGroupPolicy(inserted.id, 1, { updatePolicy: { maturityMode: 'all' } }, 'u');

    expect(
      groupPolicy.replaceGroupPolicy(inserted.id, 1, { updatePolicy: { skipTags: ['x'] } }, 'u'),
    ).toBeUndefined();
    expect(
      groupPolicy.replaceGroupPolicy('missing', 1, { updatePolicy: { skipTags: ['x'] } }, 'u'),
    ).toBeUndefined();
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toMatchObject({
      revision: 2,
      updatePolicy: { maturityMode: 'all' },
    });
  });

  test('validates the body before touching the row', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'u',
    );

    expect(() => groupPolicy.replaceGroupPolicy(inserted.id, 1, {}, 'u')).toThrow(
      GroupPolicyValidationError,
    );
    expect(readRow(inserted.id)).toMatchObject({ revision: 1 });
  });
});

describe('deleteGroupPolicy', () => {
  test('removes the row and the cached entry when the expected revision matches', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'u',
    );

    expect(groupPolicy.deleteGroupPolicy(inserted.id, 1)).toEqual(inserted);
    expect(readRow(inserted.id)).toBeUndefined();
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toBeUndefined();
  });

  test('keeps the policy for a stale revision or an unknown id', () => {
    const inserted = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'u',
    );

    expect(groupPolicy.deleteGroupPolicy(inserted.id, 2)).toBeUndefined();
    expect(groupPolicy.deleteGroupPolicy('missing', 1)).toBeUndefined();
    expect(groupPolicy.getGroupPolicyForGroup('payments')).toEqual(inserted);
  });
});

describe('transaction', () => {
  test('commits every write inside it together', () => {
    const result = groupPolicy.transaction(() => {
      groupPolicy.insertGroupPolicy('api', { updatePolicy: { maturityMode: 'all' } }, 'u');
      groupPolicy.insertGroupPolicy('web', { updatePolicy: { maturityMode: 'all' } }, 'u');
      return 'done';
    });

    expect(result).toBe('done');
    expect(db.prepare('SELECT COUNT(*) AS n FROM group_policies').get()).toEqual({ n: 2 });
  });

  test('rolls the row and the cache back together when a later step fails', () => {
    const kept = groupPolicy.insertGroupPolicy(
      'payments',
      { updatePolicy: { maturityMode: 'mature' } },
      'u',
    );

    expect(() =>
      groupPolicy.transaction(() => {
        groupPolicy.replaceGroupPolicy(kept.id, 1, { updatePolicy: { maturityMode: 'all' } }, 'u');
        groupPolicy.insertGroupPolicy('web', { updatePolicy: { maturityMode: 'all' } }, 'u');
        throw new Error('audit insert failed');
      }),
    ).toThrow('audit insert failed');

    expect(groupPolicy.getGroupPolicyForGroup('payments')).toEqual(kept);
    expect(groupPolicy.getGroupPolicyForGroup('web')).toBeUndefined();
    expect(readRow(kept.id)).toMatchObject({ revision: 1 });
  });

  test('refuses to run before the collection exists', () => {
    groupPolicy.clearCollectionForTesting();

    expect(() => groupPolicy.transaction(() => 'never')).toThrow(
      'group policies collection not initialized',
    );
  });
});
