import * as notification from './notification.js';

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

function createCollection(initialValues: any[] = []) {
  let values = [...initialValues];
  return {
    find: vi.fn(() => [...values]),
    findOne: vi.fn((query = {}) => {
      const queryEntries = Object.entries(query);
      if (queryEntries.length === 0) {
        return values[0] ?? null;
      }
      return (
        values.find((value) => queryEntries.every(([key, expected]) => value[key] === expected)) ??
        null
      );
    }),
    insert: vi.fn((value) => {
      values.push(value);
    }),
    remove: vi.fn((valueToRemove) => {
      values = values.filter((value) => value !== valueToRemove);
    }),
  };
}

describe('Notification Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('createCollections should create default notification rules when collection is empty', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => null),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);

    expect(db.addCollection).toHaveBeenCalledWith('notifications');
    expect(notification.getNotificationRules()).toEqual(notification.DEFAULT_NOTIFICATION_RULES);
  });

  test('createCollections should normalize existing rules and preserve custom rules', () => {
    const collection = createCollection([
      {
        id: 'update-available',
        name: 'Update Available',
        description: 'custom description',
        enabled: false,
        triggers: ['smtp.ops', 'smtp.ops', '', 'slack.ops'],
        unknown: true,
      },
      {
        id: 'custom-rule',
        name: 'Custom Rule',
        description: '',
        enabled: true,
        triggers: ['trig-1'],
      },
    ]);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    notification.createCollections(db);
    const rules = notification.getNotificationRules();

    expect(rules.find((rule) => rule.id === 'update-available')).toEqual({
      id: 'update-available',
      name: 'Update Available',
      description: 'When a container has a new version',
      enabled: false,
      triggers: ['slack.ops', 'smtp.ops'],
    });
    expect(rules.find((rule) => rule.id === 'security-alert')).toEqual({
      id: 'security-alert',
      name: 'Security Alert',
      description: 'Critical/High vulnerability detected',
      enabled: true,
      triggers: [],
    });
    expect(rules.find((rule) => rule.id === 'custom-rule')).toEqual({
      id: 'custom-rule',
      name: 'Custom Rule',
      description: '',
      enabled: true,
      triggers: ['trig-1'],
    });
  });

  test('createCollections should normalize non-array persisted payloads', () => {
    const values: any[] = [];
    const collection = {
      find: vi
        .fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementation(() => [...values]),
      findOne: vi.fn((query = {}) => values.find((value) => value.id === query.id) || null),
      insert: vi.fn((value) => {
        values.push(value);
      }),
      remove: vi.fn((valueToRemove) => {
        const index = values.indexOf(valueToRemove);
        if (index >= 0) values.splice(index, 1);
      }),
    };
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    notification.createCollections(db);

    expect(notification.getNotificationRule('update-available')).toEqual({
      id: 'update-available',
      name: 'Update Available',
      description: 'When a container has a new version',
      enabled: true,
      triggers: [],
    });
  });

  test('createCollections should ignore invalid rule entries in persisted array', () => {
    const collection = createCollection([
      null,
      'invalid',
      { id: 12, enabled: false },
      {
        id: 'custom-valid',
        name: 'Custom Valid',
        description: '',
        enabled: true,
        triggers: ['foo'],
      },
    ]);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    notification.createCollections(db);

    expect(notification.getNotificationRule('custom-valid')).toEqual({
      id: 'custom-valid',
      name: 'Custom Valid',
      description: '',
      enabled: true,
      triggers: ['foo'],
    });
  });

  test('createCollections should normalize non-array trigger lists and sort multiple custom rules', () => {
    const collection = createCollection([
      {
        id: 'z-rule',
        name: 'Z Rule',
        description: '',
        enabled: true,
        triggers: 'not-an-array',
      },
      {
        id: 'a-rule',
        name: 'A Rule',
        description: '',
        enabled: true,
        triggers: ['trig-a'],
      },
    ]);
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    notification.createCollections(db);
    const customRules = notification
      .getNotificationRules()
      .filter((rule) => rule.id === 'a-rule' || rule.id === 'z-rule');

    expect(customRules).toEqual([
      {
        id: 'a-rule',
        name: 'A Rule',
        description: '',
        enabled: true,
        triggers: ['trig-a'],
      },
      {
        id: 'z-rule',
        name: 'Z Rule',
        description: '',
        enabled: true,
        triggers: [],
      },
    ]);
  });

  test('getNotificationRule should return one rule by id', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);

    expect(notification.getNotificationRule('update-applied')).toEqual({
      id: 'update-applied',
      name: 'Update Applied',
      description: 'After a container is successfully updated',
      enabled: true,
      triggers: [],
    });
  });

  test('getNotificationRule should return undefined for unknown rule', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);
    expect(notification.getNotificationRule('unknown')).toBeUndefined();
  });

  test('getNotificationRule should fallback to default rule when collection lookup misses an existing default id', () => {
    const collection = {
      find: vi.fn(() => []),
      findOne: vi.fn(() => null),
      insert: vi.fn(),
      remove: vi.fn(),
    };
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(),
    };

    notification.createCollections(db);
    expect(notification.getNotificationRule('update-failed')).toEqual({
      id: 'update-failed',
      name: 'Update Failed',
      description: 'When an update fails or is rolled back',
      enabled: true,
      triggers: [],
    });
  });

  test('getNotificationRule should return undefined for invalid id values', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);
    expect(notification.getNotificationRule('')).toBeUndefined();
    expect(notification.getNotificationRule(undefined as unknown as string)).toBeUndefined();
  });

  test('updateNotificationRule should merge values and normalize trigger ids', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

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
    });
    expect(notification.getNotificationRule('update-applied')).toEqual(updated);
  });

  test('updateNotificationRule should return undefined for unknown rule id', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);
    expect(notification.updateNotificationRule('missing', { enabled: false })).toBeUndefined();
  });

  test('isTriggerEnabledForRule should return false for invalid rule/trigger ids', () => {
    expect(notification.isTriggerEnabledForRule('', 'slack.ops')).toBe(false);
    expect(notification.isTriggerEnabledForRule('update-available', '')).toBe(false);
  });

  test('updateNotificationRule should throw on invalid payload', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);
    expect(() =>
      notification.updateNotificationRule('update-applied', {
        enabled: 'yes' as unknown as boolean,
      }),
    ).toThrow();
  });

  test('isTriggerEnabledForRule should honor enabled flag and trigger allow-list', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

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

  test('isTriggerEnabledForRule should support allow-all fallback when no triggers are configured', () => {
    const collection = createCollection();
    const db = {
      getCollection: vi.fn(() => collection),
      addCollection: vi.fn(() => collection),
    };

    notification.createCollections(db);
    notification.updateNotificationRule('update-available', {
      enabled: true,
      triggers: [],
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

  test('isTriggerEnabledForRule should use missing-rule fallback option', () => {
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

  test('should use defaults when collection has not been initialized yet', async () => {
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
    });
    expect(freshNotification.updateNotificationRule('update-available', { enabled: false })).toBe(
      undefined,
    );
    expect(freshNotification.getNotificationRule('missing-default')).toBeUndefined();
  });
});
