const {
  captureContainerState,
  captureNotificationRuleState,
  captureSettingsState,
  restoreContainerState,
  restoreNotificationRuleState,
  restoreSettingsState,
} = require('./state-restoration');

const containerSnapshot = Symbol('container state snapshot');
const notificationSnapshot = Symbol('notification state snapshot');
const settingsSnapshot = Symbol('settings state snapshot');

function registerStateRestorationHooks({ After, Before }, request) {
  Before({ tags: '@restores_container_state' }, async function captureContainer() {
    this[containerSnapshot] = await captureContainerState(request, 'hub_nginx_120');
  });
  After({ tags: '@restores_container_state' }, async function restoreContainer() {
    if (this[containerSnapshot]) {
      await restoreContainerState(request, this[containerSnapshot]);
    }
  });

  Before({ tags: '@restores_settings_state' }, async function captureSettings() {
    this[settingsSnapshot] = await captureSettingsState(request);
  });
  After({ tags: '@restores_settings_state' }, async function restoreSettings() {
    if (this[settingsSnapshot]) {
      await restoreSettingsState(request, this[settingsSnapshot]);
    }
  });

  Before({ tags: '@restores_notification_state' }, async function captureNotification() {
    this[notificationSnapshot] = await captureNotificationRuleState(request, 'update-available');
  });
  After({ tags: '@restores_notification_state' }, async function restoreNotification() {
    if (this[notificationSnapshot]) {
      await restoreNotificationRuleState(request, this[notificationSnapshot]);
    }
  });
}

module.exports = { registerStateRestorationHooks };
