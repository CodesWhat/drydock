import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, type ObjectDirective } from 'vue';
import { i18n, type SupportedLocale } from '@/boot/i18n';
import CopyableTag from '@/components/CopyableTag.vue';
import DataFilterBar from '@/components/DataFilterBar.vue';

const labels: Array<[SupportedLocale, string, string, string]> = [
  ['en', 'Table', 'Cards', 'Copy failed'],
  ['ar', 'جدول', 'بطاقات', 'فشل النسخ'],
  ['de', 'Tabelle', 'Karten', 'Kopieren fehlgeschlagen'],
  ['es', 'Tabla', 'Tarjetas', 'Hubo un fallo al copiar'],
  ['fr', 'Tableau', 'Cartes', 'Échec de la copie'],
  ['it', 'Tabella', 'Schede', 'Copia non riuscita'],
  ['ja', 'テーブル', 'カード', 'コピーに失敗しました'],
  ['ko', '표', '카드', '복사 실패'],
  ['nl', 'Tabel', 'Kaarten', 'Kopiëren mislukt'],
  ['pl', 'Tabela', 'Karty', 'Kopiowanie nie powiodło się'],
  ['pt-BR', 'Tabela', 'Cartões', 'Falha ao copiar'],
  ['ru', 'Таблица', 'Карточки', 'Не удалось скопировать'],
  ['tr', 'Tablo', 'Kartlar', 'Kopyalama başarısız'],
  ['uk', 'Таблиця', 'Картки', 'Не вдалося скопіювати'],
  ['vi', 'Bảng', 'Thẻ', 'Sao chép thất bại'],
  ['zh-CN', '表', '卡片', '复制失败'],
  ['zh-TW', '表格', '卡片', '複製失敗'],
];

function tooltipObserver() {
  const values = new Map<Element, unknown>();
  const directive: ObjectDirective = {
    mounted: (el, binding) => {
      values.set(el, binding.value);
    },
    updated: (el, binding) => {
      values.set(el, binding.value);
    },
  };
  return { values, directive };
}

describe('localized shared control labels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    i18n.global.locale.value = 'en';
    delete (document as Partial<Document>).execCommand;
  });

  it.each(labels)(
    'renders %s view buttons and emits stable mode IDs',
    async (locale, table, cards) => {
      i18n.global.locale.value = locale;
      const { values, directive } = tooltipObserver();
      const wrapper = mount(DataFilterBar, {
        props: { modelValue: 'table', filteredCount: 1, totalCount: 2, showFilters: false },
        global: { directives: { tooltip: directive } },
      });
      try {
        const buttons = wrapper.get('[data-test="data-filter-bar-view-modes"]').findAll('button');
        expect(buttons).toHaveLength(2);
        for (const [index, label] of [table, cards].entries()) {
          const button = buttons[index]!;
          const expected = i18n.global.t('sharedComponents.dataFilterBar.viewModeLabel', { label });
          expect(button.attributes('aria-label')).toBe(expected);
          expect(values.get(button.element)).toBe(expected);
          await button.trigger('click');
        }
        expect(wrapper.emitted('update:modelValue')).toEqual([['table'], ['cards']]);
        i18n.global.locale.value = 'en';
        await nextTick();
        expect(buttons[1]!.attributes('aria-label')).toBe('Cards view');
        expect(values.get(buttons[1]!.element)).toBe('Cards view');
        expect(wrapper.emitted('update:modelValue')).toHaveLength(2);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each(labels)(
    'renders %s clipboard failure and updates language without retrying',
    async (locale, _table, _cards, failed) => {
      i18n.global.locale.value = locale;
      const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      document.execCommand = vi.fn().mockReturnValue(false);
      const { values, directive } = tooltipObserver();
      const wrapper = mount(CopyableTag, {
        props: { tag: 'v1.8.0-candidate' },
        global: { directives: { tooltip: directive } },
      });
      try {
        await wrapper.trigger('click');
        await flushPromises();
        expect(values.get(wrapper.element)).toBe(failed);
        expect(wrapper.text()).toBe('v1.8.0-candidate');
        expect(wrapper.get('span > span').attributes('style')).toContain('color: var(--dd-danger)');
        i18n.global.locale.value = 'en';
        await nextTick();
        expect(values.get(wrapper.element)).toBe('Copy failed');
        expect(writeText).toHaveBeenCalledExactlyOnceWith('v1.8.0-candidate');
        expect(document.execCommand).toHaveBeenCalledExactlyOnceWith('copy');
        await vi.advanceTimersByTimeAsync(1500);
        expect(values.get(wrapper.element)).toBe('Click to copy');
      } finally {
        wrapper.unmount();
      }
    },
  );
});
