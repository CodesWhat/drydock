import type { WatcherEditOutcome } from '@/services/config-editor';
import type { NotificationEditSnapshot } from '@/services/notification-editor';

export function notificationSnapshot(): NotificationEditSnapshot {
  return {
    available: true,
    revision: 'initial',
    triggers: [
      {
        id: 'discord.policy',
        type: 'discord',
        name: 'policy',
        category: 'notification',
        fields: {
          threshold: {
            present: true,
            source: 'file',
            path: ['Notification', 'Discord', 'Policy', 'threshold'],
            value: 'all',
            effectiveValue: 'all',
          },
          once: {
            present: true,
            source: 'file',
            path: ['Notification', 'Discord', 'Policy', 'once'],
            value: true,
            effectiveValue: true,
          },
          mode: {
            present: true,
            source: 'file',
            path: ['Notification', 'Discord', 'Policy', 'mode'],
            value: 'simple',
            effectiveValue: 'simple',
          },
          securitymode: {
            present: false,
            source: 'default',
            path: ['Notification', 'Discord', 'Policy', 'securitymode'],
            effectiveValue: 'simple',
          },
          digestcron: {
            present: true,
            source: 'file',
            path: ['Notification', 'Discord', 'Policy', 'digestcron'],
            value: '0 8 * * *',
            effectiveValue: '0 8 * * *',
          },
          resolvenotifications: {
            present: false,
            source: 'default',
            path: ['Notification', 'Discord', 'Policy', 'resolvenotifications'],
            effectiveValue: false,
          },
        },
      },
    ],
  };
}
export function notificationOutcome(
  overrides: Partial<WatcherEditOutcome> = {},
): WatcherEditOutcome {
  return {
    status: 200,
    saved: true,
    applied: true,
    revision: 'next',
    changedKeys: [],
    restartRequired: [],
    errors: [],
    ...overrides,
  };
}
