import { createMigratedMemoryDatabase } from '../test/sqlite-db.js';
import type { Database } from './db/driver.js';
import * as notification from './notification.js';

vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function notificationPreferences(bellEnabled = false) {
  return {
    bellEnabled,
    bellThreshold: 'all',
    templates: {},
  };
}

/**
 * Write a rule straight into the tables, bypassing the module, to stand in for a row a
 * previous run (or the first-start importer) already wrote. Every column here is
 * NOT NULL, so this can only model a fully-formed row — the "legacy document missing a
 * field" shape belongs to `store/db/importers/notification-rules.test.ts`, which reads
 * arbitrary pre-1.8 JSON instead of an already-migrated table.
 */
function insertRawRule(
  database: Database,
  rule: {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    bellEnabled: boolean;
    bellThreshold: string;
    triggers?: string[];
    templates?: Record<string, Record<string, string>>;
  },
): void {
  database
    .prepare(
      `INSERT INTO notification_rules (id, name, description, enabled, bell_enabled, bell_threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rule.id,
      rule.name,
      rule.description,
      rule.enabled ? 1 : 0,
      rule.bellEnabled ? 1 : 0,
      rule.bellThreshold,
    );
  (rule.triggers ?? []).forEach((triggerId, ordinal) => {
    database
      .prepare(
        'INSERT INTO notification_rule_trigger (rule_id, trigger_id, ordinal) VALUES (?, ?, ?)',
      )
      .run(rule.id, triggerId, ordinal);
  });
  for (const [triggerId, fields] of Object.entries(rule.templates ?? {})) {
    for (const [field, value] of Object.entries(fields)) {
      database
        .prepare(
          'INSERT INTO notification_rule_template (rule_id, trigger_id, field, value) VALUES (?, ?, ?, ?)',
        )
        .run(rule.id, triggerId, field, value);
    }
  }
}

let db: Database;

beforeEach(() => {
  db = createMigratedMemoryDatabase();
});

afterEach(() => {
  db.close();
});

describe('createCollections', () => {
  test('creates default notification rules on an empty database', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRules()).toEqual(notification.DEFAULT_NOTIFICATION_RULES);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_rules').get()).toEqual({
      n: notification.DEFAULT_NOTIFICATION_RULES.length,
    });
  });

  test('default rules expose backward-compatible bell and template preferences', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRule('update-available')).toMatchObject({
      bellEnabled: true,
      bellThreshold: 'all',
      templates: {},
    });
    expect(notification.getNotificationRule('container-unhealthy')).toMatchObject({
      bellEnabled: false,
      bellThreshold: 'all',
      templates: {},
    });
  });

  test('normalizes an already-persisted default rule and preserves custom rules, sorted by id', () => {
    insertRawRule(db, {
      id: 'update-available',
      name: 'Update Available',
      description: 'stale description',
      enabled: false,
      bellEnabled: true,
      bellThreshold: 'major',
      triggers: ['slack.ops', 'smtp.ops'],
    });
    insertRawRule(db, {
      id: 'z-custom',
      name: 'Z Custom',
      description: '',
      enabled: true,
      bellEnabled: false,
      bellThreshold: 'all',
      triggers: ['trig-z'],
    });
    insertRawRule(db, {
      id: 'a-custom',
      name: 'A Custom',
      description: '',
      enabled: true,
      bellEnabled: false,
      bellThreshold: 'all',
      triggers: ['trig-a'],
    });

    notification.createCollections(db);
    const rules = notification.getNotificationRules();

    // The description of a known default rule always comes from the catalog, never
    // from whatever was persisted.
    expect(rules.find((rule) => rule.id === 'update-available')).toEqual({
      id: 'update-available',
      name: 'Update Available',
      description: 'When a container has a new version',
      enabled: false,
      triggers: ['slack.ops', 'smtp.ops'],
      bellEnabled: true,
      bellThreshold: 'major',
      templates: {},
    });
    const customIds = rules.filter((rule) => rule.id.endsWith('-custom')).map((rule) => rule.id);
    expect(customIds).toEqual(['a-custom', 'z-custom']);
  });

  test('a second call preserves whatever changed since the first', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-applied', {
      enabled: false,
      triggers: ['slack.ops'],
    });

    notification.createCollections(db);

    expect(notification.getNotificationRule('update-applied')).toMatchObject({
      enabled: false,
      triggers: ['slack.ops'],
    });
  });
});

describe('getNotificationRule', () => {
  test('returns one rule by id', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRule('update-applied')).toEqual({
      id: 'update-applied',
      name: 'Update Applied',
      description: 'After a container is successfully updated',
      enabled: true,
      triggers: [],
      ...notificationPreferences(true),
    });
  });

  test('exposes the default agent reconnect rule', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRule('agent-reconnect')).toEqual({
      id: 'agent-reconnect',
      name: 'Agent Reconnected',
      description: 'When a remote agent reconnects after losing connection',
      enabled: false,
      triggers: [],
      ...notificationPreferences(),
    });
  });

  test('exposes the disabled container-unhealthy rule with an empty allow-list', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRule('container-unhealthy')).toEqual({
      id: 'container-unhealthy',
      name: 'Container Unhealthy',
      description: "When a container's Docker health check enters the unhealthy state",
      enabled: false,
      triggers: [],
      ...notificationPreferences(),
    });
  });

  test('container unhealthy rule updates persist and round-trip', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('container-unhealthy', {
      enabled: true,
      triggers: ['slack.myslack'],
    });

    expect(notification.getNotificationRule('container-unhealthy')).toMatchObject({
      enabled: true,
      triggers: ['slack.myslack'],
    });
  });

  test('returns undefined for unknown rule', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRule('unknown')).toBeUndefined();
  });

  test('returns undefined for invalid id values', () => {
    notification.createCollections(db);

    expect(notification.getNotificationRule('')).toBeUndefined();
    expect(notification.getNotificationRule(undefined as unknown as string)).toBeUndefined();
  });
});

describe('getNotificationTemplate', () => {
  test('a returned rule is a copy: mutating it does not affect the stored template', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-available', {
      templates: {
        'slack.ops': {
          simpleTitle: 'title one',
          simpleBody: 'body one',
          batchTitle: 'batch one',
        },
      },
    });

    const read = notification.getNotificationRule('update-available') as unknown as {
      templates: Record<string, Record<string, string>>;
    };
    read.templates['slack.ops'].simpleTitle = 'mutated';

    expect(
      notification.getNotificationTemplate('update-available', 'slack.ops', 'simpleTitle'),
    ).toBe('title one');
  });
});

describe('updateNotificationRule', () => {
  test('merges values and normalizes trigger ids', () => {
    notification.createCollections(db);

    const updated = notification.updateNotificationRule('UPDATE-APPLIED', {
      enabled: false,
      triggers: ['smtp.ops', 'slack.ops', 'smtp.ops', ''],
    });

    expect(updated).toEqual({
      id: 'update-applied',
      name: 'Update Applied',
      description: 'After a container is successfully updated',
      enabled: false,
      triggers: ['slack.ops', 'smtp.ops'],
      ...notificationPreferences(true),
    });
    expect(notification.getNotificationRule('update-applied')).toEqual(updated);
  });

  test('carries an existing template override through the merge', () => {
    notification.createCollections(db);
    db.prepare(
      'INSERT INTO notification_rule_template (rule_id, trigger_id, field, value) VALUES (?, ?, ?, ?)',
    ).run('update-applied', 'slack.ops', 'simpleTitle', 'title one');

    const updated = notification.updateNotificationRule('update-applied', { enabled: false });

    expect(updated?.templates).toEqual({ 'slack.ops': { simpleTitle: 'title one' } });
    expect(notification.getNotificationRule('update-applied')?.templates).toEqual({
      'slack.ops': { simpleTitle: 'title one' },
    });
  });

  test('returns undefined for unknown rule id', () => {
    notification.createCollections(db);

    expect(notification.updateNotificationRule('missing', { enabled: false })).toBeUndefined();
  });

  test('returns undefined when the store has not been created', async () => {
    vi.resetModules();
    const freshNotification = await import('./notification.js');

    expect(freshNotification.updateNotificationRule('update-available', { enabled: false })).toBe(
      undefined,
    );
  });

  test('throws on invalid payload', () => {
    notification.createCollections(db);

    expect(() =>
      notification.updateNotificationRule('update-applied', {
        enabled: 'yes' as unknown as boolean,
      }),
    ).toThrow();
  });
});

describe('trigger dispatch decisions', () => {
  test('isTriggerEnabledForRule returns false for invalid rule/trigger ids', () => {
    expect(notification.isTriggerEnabledForRule('', 'slack.ops')).toBe(false);
    expect(notification.isTriggerEnabledForRule('update-available', '')).toBe(false);
  });

  test('honors the enabled flag and the trigger allow-list', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-applied', {
      enabled: true,
      triggers: ['slack.ops'],
    });

    expect(notification.isTriggerEnabledForRule('update-applied', 'slack.ops')).toBe(true);
    expect(notification.isTriggerEnabledForRule('update-applied', 'smtp.ops')).toBe(false);

    notification.updateNotificationRule('update-applied', { enabled: false });
    expect(notification.isTriggerEnabledForRule('update-applied', 'slack.ops')).toBe(false);
  });

  test('matches shorthand trigger references against full ids', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-available', {
      triggers: ['mobile', 'smtp.gmail'],
    });

    expect(
      notification.getTriggerDispatchDecisionForRule('update-available', 'edge.pushover.mobile', {
        allowAllWhenNoTriggers: true,
      }),
    ).toEqual({
      enabled: true,
      reason: 'matched-allow-list',
    });
    expect(
      notification.getTriggerDispatchDecisionForRule('update-available', 'edge.smtp.gmail', {
        allowAllWhenNoTriggers: true,
      }),
    ).toEqual({
      enabled: true,
      reason: 'matched-allow-list',
    });
  });

  test('supports allow-all fallback when no triggers are configured', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-available', {
      enabled: true,
      triggers: [],
      ...notificationPreferences(true),
    });

    expect(
      notification.isTriggerEnabledForRule('update-available', 'docker.update', {
        allowAllWhenNoTriggers: true,
      }),
    ).toBe(true);
    expect(
      notification.isTriggerEnabledForRule('update-available', 'docker.update', {
        allowAllWhenNoTriggers: false,
      }),
    ).toBe(false);
  });

  test('exposes whether a trigger was excluded by allow-list routing', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-available', {
      enabled: true,
      triggers: ['pushover.mobile'],
    });

    expect(
      notification.getTriggerDispatchDecisionForRule('update-available', 'smtp.gmail', {
        allowAllWhenNoTriggers: true,
      }),
    ).toEqual({
      enabled: false,
      reason: 'excluded-from-allow-list',
    });
  });

  test('treats empty update-available triggers as allow-all when requested', () => {
    notification.createCollections(db);
    notification.updateNotificationRule('update-available', {
      enabled: true,
      triggers: [],
      ...notificationPreferences(true),
    });

    expect(
      notification.getTriggerDispatchDecisionForRule('update-available', 'smtp.gmail', {
        allowAllWhenNoTriggers: true,
      }),
    ).toEqual({
      enabled: true,
      reason: 'allow-all-when-empty',
    });
  });

  test('uses the missing-rule fallback option', () => {
    expect(
      notification.isTriggerEnabledForRule('missing-rule', 'docker.update', {
        defaultWhenRuleMissing: true,
      }),
    ).toBe(true);
    expect(
      notification.isTriggerEnabledForRule('missing-rule', 'docker.update', {
        defaultWhenRuleMissing: false,
      }),
    ).toBe(false);
  });
});

describe('module state before initialization', () => {
  test('uses defaults when the store has not been created yet', async () => {
    vi.resetModules();
    const freshNotification = await import('./notification.js');

    expect(freshNotification.getNotificationRules()).toEqual(
      freshNotification.DEFAULT_NOTIFICATION_RULES,
    );
    expect(freshNotification.getNotificationRule('update-available')).toEqual({
      id: 'update-available',
      name: 'Update Available',
      description: 'When a container has a new version',
      enabled: true,
      triggers: [],
      ...notificationPreferences(true),
    });
    expect(freshNotification.getNotificationRule('missing-default')).toBeUndefined();
  });
});

describe('getNotificationRules caching', () => {
  test('caches normalized rules and invalidates the cache after a write', () => {
    notification.createCollections(db);
    const prepareSpy = vi.spyOn(db, 'prepare');
    const countRuleTableReads = () =>
      prepareSpy.mock.calls.filter(([sql]) => sql === 'SELECT * FROM notification_rules').length;

    notification.getNotificationRules();
    const readsAfterFirstGet = countRuleTableReads();
    notification.getNotificationRules();
    expect(countRuleTableReads()).toBe(readsAfterFirstGet);

    notification.updateNotificationRule('update-applied', { enabled: false });
    const readsBeforeGetAfterWrite = countRuleTableReads();
    const rulesAfterWrite = notification.getNotificationRules();

    expect(rulesAfterWrite.find((rule) => rule.id === 'update-applied')?.enabled).toBe(false);
    expect(countRuleTableReads()).toBe(readsBeforeGetAfterWrite + 1);
  });
});
