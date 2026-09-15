import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { i18n } from '@/boot/i18n';
import { useDetailPanel } from '@/composables/useDetailPanel';
import { SUPPORTED_LOCALES } from '@/i18n/locales';

const TabLabels = defineComponent({
  setup() {
    const { detailTabs } = useDetailPanel();
    return () =>
      h(
        'nav',
        detailTabs.value.map((tab) => h('span', { key: tab.id }, tab.label)),
      );
  },
});

describe('container detail tab translations', () => {
  const originalLocale = i18n.global.locale.value;

  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))(
    'renders localized overview and environment tabs in %s',
    (locale) => {
      i18n.global.locale.value = locale;
      const wrapper = mount(TabLabels);
      try {
        const labels = wrapper.findAll('span').map((tab) => tab.text());
        expect(labels).toHaveLength(6);
        for (const label of labels) {
          expect(label).not.toBe('');
          expect(label).not.toContain('containerComponents.');
        }
        // Technical loanwords such as Logs or Labels can legitimately match English.
        expect(labels[0]).not.toBe('Overview');
        expect(labels[3]).not.toBe('Environment');
      } finally {
        wrapper.unmount();
      }
    },
  );

  it('updates an already mounted panel when the language changes', async () => {
    i18n.global.locale.value = 'en';
    const wrapper = mount(TabLabels);
    try {
      expect(wrapper.find('span').text()).toBe('Overview');
      i18n.global.locale.value = 'fr';
      await nextTick();
      expect(wrapper.findAll('span').map((tab) => tab.text())).toEqual([
        'Vue d’ensemble',
        'Statistiques',
        'Logs',
        'Environnement',
        'Balises',
        'Actions',
      ]);
    } finally {
      wrapper.unmount();
    }
  });
});
