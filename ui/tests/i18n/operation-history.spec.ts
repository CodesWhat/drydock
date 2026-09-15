import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createI18n } from 'vue-i18n';
import { SUPPORTED_LOCALES } from '../../src/i18n/locales';
import en from '../../src/locales/en/containerComponents.json';
import fr from '../../src/locales/fr/containerComponents.json';
import {
  isContainerUpdateOperationPhase,
  isContainerUpdateOperationStatus,
} from '../../src/types/update-operation';
import {
  formatOperationPhase,
  formatOperationStatus,
  formatRollbackReason,
} from '../../src/views/containers/useContainerBackups';

const i18n = createI18n({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'en',
  messages: { en, fr },
});

describe('operation history localization', () => {
  it('translates known statuses with the current locale', () => {
    expect(formatOperationStatus('in-progress', i18n.global.t)).toBe('En cours');
    expect(formatOperationStatus(' ROLLED_BACK ', i18n.global.t)).toBe('Restauration effectuée');
  });

  it('translates phases and rollback reasons rather than just humanizing their codes', () => {
    expect(formatOperationPhase('health-gate', i18n.global.t)).toBe('Vérification de santé');
    expect(formatRollbackReason('create_new_failed', i18n.global.t)).toBe(
      'Échec de création du nouveau conteneur',
    );
  });

  it('keeps unknown future codes and diagnostic reasons visible without translating arbitrary keys', () => {
    const translate = vi.fn();
    expect(formatOperationPhase('FUTURE_PHASE', translate)).toBe('future phase');
    expect(formatOperationStatus('constructor', translate)).toBe('constructor');
    expect(formatRollbackReason('Custom provider failure', translate)).toBe(
      'custom provider failure',
    );
    expect(translate).not.toHaveBeenCalled();
  });

  it('retains the no-translator fallback and translates missing values', () => {
    expect(formatOperationStatus('in-progress')).toBe('in progress');
    expect(formatOperationPhase('health-gate')).toBe('health gate');
    expect(formatRollbackReason('create_new_failed')).toBe('create new failed');
    expect(formatOperationStatus(undefined, i18n.global.t)).toBe(
      i18n.global.t('containerComponents.sideTabContent.unknown'),
    );
  });

  it.each(SUPPORTED_LOCALES)('renders every operation value from %s without fallback', (locale) => {
    const messages = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          `../../src/locales/${locale}/containerComponents.json`,
        ),
        'utf8',
      ),
    );
    const values = messages.containerComponents.backups.operationValues;
    expect(Object.keys(values).sort()).toEqual(
      Object.keys(en.containerComponents.backups.operationValues).sort(),
    );
    const local = createI18n({
      legacy: false,
      locale,
      fallbackLocale: false,
      messages: { [locale]: messages },
    });
    for (const [code, label] of Object.entries(values)) {
      expect(typeof label).toBe('string');
      expect(label).not.toBe('');
      const format = isContainerUpdateOperationPhase(code)
        ? formatOperationPhase
        : isContainerUpdateOperationStatus(code)
          ? formatOperationStatus
          : formatRollbackReason;
      expect(format(code, local.global.t)).toBe(label);
    }
  });

  it('updates labels when the selected locale changes', () => {
    i18n.global.locale.value = 'en';
    expect(formatOperationStatus('in-progress', i18n.global.t)).toBe('In progress');
    i18n.global.locale.value = 'fr';
    expect(formatOperationStatus('in-progress', i18n.global.t)).toBe('En cours');
  });
});
