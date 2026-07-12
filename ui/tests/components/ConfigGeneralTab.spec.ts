import { mount } from '@vue/test-utils';
import ConfigGeneralTab from '@/components/config/ConfigGeneralTab.vue';

function mountTab() {
  return mount(ConfigGeneralTab, {
    props: {
      loading: false,
      serverError: '',
      settingsError: '',
      serverFields: [],
      storeFields: [],
      webhookEnabled: false,
      webhookEndpoints: [],
      webhookExample: '',
      internetlessMode: false,
      updateMode: 'manual',
      settingsLoading: false,
      cacheClearing: false,
      cacheCleared: null,
      debugDumpDownloading: false,
      debugDumpError: '',
    },
    global: {
      stubs: {
        AppIcon: { template: '<span />' },
        DataTable: { template: '<div />' },
        ToggleSwitch: { template: '<button />' },
      },
    },
  });
}

describe('ConfigGeneralTab update mode', () => {
  it('renders all three global modes and marks the active option', () => {
    const wrapper = mountTab();

    const options = wrapper.findAll('[data-test^="update-mode-"]');
    expect(options.map((option) => option.attributes('data-test'))).toEqual([
      'update-mode-notify',
      'update-mode-manual',
      'update-mode-auto',
    ]);
    expect(wrapper.get('[data-test="update-mode-manual"]').attributes('aria-pressed')).toBe('true');
  });

  it('emits the selected update mode', async () => {
    const wrapper = mountTab();

    await wrapper.get('[data-test="update-mode-auto"]').trigger('click');

    expect(wrapper.emitted('update-mode')).toEqual([['auto']]);
  });
});
