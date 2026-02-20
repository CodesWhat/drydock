import { mount } from '@vue/test-utils';
import WebhookInfo from '@/components/WebhookInfo.vue';

describe('WebhookInfo', () => {
  let wrapper;

  function createWrapper(props = {}) {
    return mount(WebhookInfo, {
      props: {
        enabled: false,
        baseUrl: 'http://localhost:3000',
        ...props,
      },
      global: {
        stubs: {
          'v-table': { template: '<table class="v-table"><slot /></table>' },
          'v-sheet': { template: '<div class="v-sheet"><slot /></div>' },
        },
      },
    });
  }

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('shows disabled state when not enabled', () => {
    wrapper = createWrapper({ enabled: false });
    expect(wrapper.text()).toContain('Webhook API is disabled');
    expect(wrapper.text()).toContain('DD_SERVER_WEBHOOK_ENABLED');
    expect(wrapper.text()).toContain('DD_SERVER_WEBHOOK_TOKEN');
  });

  it('shows Disabled chip when not enabled', () => {
    wrapper = createWrapper({ enabled: false });
    expect(wrapper.text()).toContain('Disabled');
  });

  it('shows Enabled chip when enabled', () => {
    wrapper = createWrapper({ enabled: true });
    expect(wrapper.text()).toContain('Enabled');
  });

  it('shows endpoint table when enabled', () => {
    wrapper = createWrapper({ enabled: true });
    expect(wrapper.text()).toContain('POST /api/webhook/watch');
    expect(wrapper.text()).toContain('POST /api/webhook/watch/:name');
    expect(wrapper.text()).toContain('POST /api/webhook/update/:name');
  });

  it('shows endpoint descriptions when enabled', () => {
    wrapper = createWrapper({ enabled: true });
    expect(wrapper.text()).toContain('Trigger a full watch cycle on all watchers');
    expect(wrapper.text()).toContain('Watch a specific container by name');
    expect(wrapper.text()).toContain('Trigger an update on a specific container');
  });

  it('shows curl example with base URL', () => {
    wrapper = createWrapper({ enabled: true, baseUrl: 'https://myhost.com' });
    expect(wrapper.text()).toContain('https://myhost.com/api/webhook/watch');
    expect(wrapper.text()).toContain('Authorization: Bearer YOUR_TOKEN');
  });

  it('shows anchor icon', () => {
    wrapper = createWrapper({ enabled: true });
    expect(wrapper.text()).toContain('fas fa-anchor');
  });

  it('toggles details when header is clicked', async () => {
    wrapper = createWrapper({ enabled: true });
    expect(wrapper.vm.showDetail).toBe(false);

    await wrapper.find('.v-card-title').trigger('click');
    expect(wrapper.vm.showDetail).toBe(true);

    await wrapper.find('.v-card-title').trigger('click');
    expect(wrapper.vm.showDetail).toBe(false);
  });

  it('does not show endpoint table when disabled', () => {
    wrapper = createWrapper({ enabled: false });
    expect(wrapper.text()).not.toContain('POST /api/webhook/watch');
  });

  it('does not show curl example when disabled', () => {
    wrapper = createWrapper({ enabled: false });
    expect(wrapper.text()).not.toContain('Authorization: Bearer');
  });

  it('shows bearer token instruction when enabled', () => {
    wrapper = createWrapper({ enabled: true });
    expect(wrapper.text()).toContain('Bearer token');
  });

  it('defaults enabled prop to false', () => {
    wrapper = mount(WebhookInfo, {
      global: {
        stubs: {
          'v-table': { template: '<table class="v-table"><slot /></table>' },
          'v-sheet': { template: '<div class="v-sheet"><slot /></div>' },
        },
      },
    });
    expect(wrapper.vm.enabled).toBe(false);
  });

  it('defaults baseUrl prop to empty string', () => {
    wrapper = mount(WebhookInfo, {
      global: {
        stubs: {
          'v-table': { template: '<table class="v-table"><slot /></table>' },
          'v-sheet': { template: '<div class="v-sheet"><slot /></div>' },
        },
      },
    });
    expect(wrapper.vm.baseUrl).toBe('');
  });
});
