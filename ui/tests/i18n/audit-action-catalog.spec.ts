import { i18n } from '@/boot/i18n';
import { BACKEND_AUDIT_ACTIONS } from '../helpers/audit-actions';

const newActionLabels = [
  'webhook-watch',
  'webhook-watch-container',
  'webhook-update',
  'mqtt-command-update',
  'security-scan-skipped',
  'scanner-asset-pull-started',
  'scanner-asset-pull-succeeded',
  'scanner-asset-pull-failed',
  'scanner-asset-warm-started',
  'scanner-asset-warm-succeeded',
  'scanner-asset-warm-failed',
  'container-unhealthy',
  'env-reveal',
  'debug-dump',
  'config-read',
  'config-validated',
  'config-reloaded',
  'config-written',
  'update-approved',
  'update-rejected',
  'update-deferred',
  'api-key-created',
  'api-key-revoked',
  'api-key-auth-failed',
];

describe('audit action catalog contract', () => {
  it.each(i18n.global.availableLocales)(
    'has an explicit caption for every backend action in %s',
    (locale) => {
      for (const action of BACKEND_AUDIT_ACTIONS) {
        expect
          .soft(i18n.global.te(`auditView.actions.${action}`, locale), `${locale}: ${action}`)
          .toBe(true);
      }
    },
  );

  it.each(i18n.global.availableLocales.filter((locale) => locale !== 'en'))(
    'translates the newly exposed captions in %s',
    (locale) => {
      for (const action of newActionLabels) {
        const key = `auditView.actions.${action}`;
        expect
          .soft(i18n.global.t(key, {}, { locale }), `${locale}: ${action}`)
          .not.toBe(i18n.global.t(key, {}, { locale: 'en' }));
      }
    },
  );
});
