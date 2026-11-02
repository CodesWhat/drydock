import { mount } from '@vue/test-utils';
import { i18n } from '@/boot/i18n';
import ConfigAppearanceTab from '@/components/config/ConfigAppearanceTab.vue';

const noop = () => {};

function mountTab() {
  return mount(ConfigAppearanceTab, {
    global: { plugins: [i18n] },
    props: {
      themeFamilies: [],
      localeOptions: [],
      fontOptions: [],
      isFontLoaded: () => true,
      libraryLabels: {},
      iconMap: {},
      radiusPresets: [],
      showSyncToggle: true,
      onSelectThemeFamily: noop,
      onSelectLocale: noop,
      onSelectFont: noop,
      onSelectIconLibrary: noop,
      onChangeIconScale: noop,
      onChangeFontSize: noop,
      onSelectRadius: noop,
      onToggleSync: noop,
    },
  });
}

describe('ConfigAppearanceTab accessible names', () => {
  it('labels both range sliders', () => {
    const wrapper = mountTab();
    const labels = wrapper
      .findAll('input[type="range"]')
      .map((input) => input.attributes('aria-label'));
    expect(labels).toEqual([
      i18n.global.t('configView.appearance.fontSize.title'),
      i18n.global.t('configView.appearance.iconSize.title'),
    ]);
    wrapper.unmount();
  });

  it('labels the sync switch', () => {
    const wrapper = mountTab();
    expect(wrapper.get('[data-test="sync-toggle"]').attributes('aria-label')).toBe(
      i18n.global.t('configView.appearance.sync.label'),
    );
    wrapper.unmount();
  });
});
