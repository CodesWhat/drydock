import { mount } from '@vue/test-utils';
import ConfigGeneralTab from '@/components/config/ConfigGeneralTab.vue';

function mountTab(overrides: Record<string, unknown> = {}) {
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
      updateModeLoaded: true,
      settingsLoading: false,
      cacheClearing: false,
      cacheCleared: null,
      debugDumpDownloading: false,
      debugDumpError: '',
      ...overrides,
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

  it('disables every option until the canonical server mode is loaded', async () => {
    const wrapper = mountTab();
    await wrapper.setProps({ updateModeLoaded: false });

    expect(wrapper.findAll('[data-test^="update-mode-"]')).toSatisfy((options) =>
      options.every((option) => option.attributes('disabled') !== undefined),
    );
  });

  it('surfaces the mode load error while leaving an unverified mode disabled', () => {
    const wrapper = mountTab({
      settingsError: 'settings unavailable',
      updateModeLoaded: false,
    });

    expect(wrapper.text()).toContain('settings unavailable');
    expect(wrapper.get('[data-test="update-mode-manual"]').attributes('disabled')).toBeDefined();
  });
});
