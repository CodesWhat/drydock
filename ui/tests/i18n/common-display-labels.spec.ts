import { i18n, setI18nLocale } from '@/boot/i18n';
import { registryLabel } from '@/utils/display';

describe('common display translations', () => {
  afterEach(() => setI18nLocale('en'));

  it.each([
    ['en', 'yes', 'no', 'Custom'],
    ['ar', 'نعم', 'لا', 'مخصص'],
    ['de', 'ja', 'nein', 'Benutzerdefiniert'],
    ['es', 'sí', 'no', 'Personalizado'],
    ['fr', 'oui', 'non', 'Personnalisé'],
    ['it', 'sì', 'no', 'Personalizzato'],
    ['ja', 'はい', 'いいえ', 'カスタム'],
    ['ko', '예', '아니요', '사용자 지정'],
    ['nl', 'ja', 'nee', 'Aangepast'],
    ['pl', 'tak', 'nie', 'Niestandardowy'],
    ['pt-BR', 'sim', 'não', 'Personalizado'],
    ['ru', 'да', 'нет', 'Пользовательский'],
    ['tr', 'evet', 'hayır', 'Özel'],
    ['uk', 'так', 'ні', 'Власний'],
    ['vi', 'có', 'không', 'Tùy chỉnh'],
    ['zh-CN', '是', '否', '自定义'],
    ['zh-TW', '是', '否', '自訂'],
  ] as const)(
    'renders %s boolean and custom labels without changing identities',
    (locale, yes, no, custom) => {
      setI18nLocale(locale);
      expect(i18n.global.t('common.yes')).toBe(yes);
      expect(i18n.global.t('common.no')).toBe(no);
      const translate = (key: string) => i18n.global.t(key);
      expect(registryLabel('custom', undefined, undefined, translate)).toBe(custom);
      expect(registryLabel('ghcr', undefined, undefined, translate)).toBe('GHCR');
      expect(registryLabel('custom', 'https://registry.example.com/v2', undefined, translate)).toBe(
        'registry.example.com',
      );
      expect(registryLabel('custom', undefined, 'Internal Registry', translate)).toBe(
        'Internal Registry',
      );
    },
  );
});
