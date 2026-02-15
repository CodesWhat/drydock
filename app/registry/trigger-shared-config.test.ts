import {
  applySharedTriggerConfigurationByName,
  applyTriggerGroupDefaults,
} from './trigger-shared-config.js';

describe('trigger-shared-config', () => {
  test('applySharedTriggerConfigurationByName should preserve nullish inputs', () => {
    expect(applySharedTriggerConfigurationByName(undefined)).toEqual({});
    expect(applySharedTriggerConfigurationByName(null)).toEqual({});
  });

  test('applySharedTriggerConfigurationByName should pass through non-record providers and triggers', () => {
    const result = applySharedTriggerConfigurationByName({
      disabled: 'off',
      ntfy: {
        threshold: 'minor',
        update: {
          topic: 'alerts',
        },
        passthrough: true,
      },
      slack: {
        update: {
          url: 'https://hooks.slack.com/a',
          threshold: 'patch',
        },
      },
    });

    expect(result.disabled).toBe('off');
    expect(result.ntfy.update).toEqual({
      threshold: 'minor',
      topic: 'alerts',
    });
    expect(result.ntfy.passthrough).toBe(true);
    expect(result.slack.update.threshold).toBe('patch');
  });

  test('applySharedTriggerConfigurationByName should share common values by trigger name', () => {
    const result = applySharedTriggerConfigurationByName({
      ntfy: {
        update: {
          topic: 'updates',
          threshold: 'minor',
          once: false,
        },
      },
      discord: {
        update: {
          url: 'https://example.com/webhook',
        },
      },
    });

    expect(result.ntfy.update.threshold).toBe('minor');
    expect(result.discord.update.threshold).toBe('minor');
    expect(result.ntfy.update.once).toBe(false);
    expect(result.discord.update.once).toBe(false);
  });

  test('applyTriggerGroupDefaults should merge group defaults into matching trigger names', () => {
    const onTriggerGroupDetected = vi.fn();
    const result = applyTriggerGroupDefaults(
      {
        update: {
          threshold: 'minor',
          once: false,
        },
        discord: {
          update: {
            url: 'https://example.com/webhook',
          },
          notify: {
            url: 'https://example.com/notify',
          },
          passthrough: true,
        },
        disabled: 'off',
      },
      new Set(['discord', 'disabled']),
      onTriggerGroupDetected,
    );

    expect(result.discord.update).toEqual({
      threshold: 'minor',
      once: false,
      url: 'https://example.com/webhook',
    });
    expect(result.discord.notify).toEqual({
      url: 'https://example.com/notify',
    });
    expect(result.discord.passthrough).toBe(true);
    expect(result.disabled).toBe('off');
    expect(onTriggerGroupDetected).toHaveBeenCalledWith('update', {
      threshold: 'minor',
      once: false,
    });
  });

  test('applyTriggerGroupDefaults should return original configuration when no groups exist', () => {
    const configurations = {
      discord: {
        update: {
          url: 'https://example.com/webhook',
        },
      },
    };

    expect(applyTriggerGroupDefaults(configurations, new Set(['discord']))).toEqual(configurations);
  });
});
