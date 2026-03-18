import { mount } from '@vue/test-utils';
import ContainerIcon from '@/components/ContainerIcon.vue';

const appIconStub = { template: '<span class="app-icon-stub" />', props: ['name', 'size'] };

function factory(props: { icon: string; size?: number }) {
  return mount(ContainerIcon, {
    props,
    global: {
      stubs: { AppIcon: appIconStub },
    },
  });
}

describe('ContainerIcon', () => {
  it('renders selfhst proxy img for sh- prefix', () => {
    const wrapper = factory({ icon: 'sh-nginx' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/selfhst/nginx');
  });

  it('renders homarr proxy img for hl- prefix', () => {
    const wrapper = factory({ icon: 'hl-portainer' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/homarr/portainer');
  });

  it('renders simple-icons proxy img for si- prefix', () => {
    const wrapper = factory({ icon: 'si-docker' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/simple/docker');
  });

  it('normalizes colon-separated sh: prefix to dash', () => {
    const wrapper = factory({ icon: 'sh:z-wave-js-ui' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/selfhst/z-wave-js-ui');
  });

  it('normalizes colon-separated hl: prefix to dash', () => {
    const wrapper = factory({ icon: 'hl:portainer' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/homarr/portainer');
  });

  it('normalizes colon-separated si: prefix to dash', () => {
    const wrapper = factory({ icon: 'si:docker' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/simple/docker');
  });

  it('normalizes nested si prefixes so proxy slug never contains a colon', () => {
    const wrapper = factory({ icon: 'si-si:nextcloud' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/simple/nextcloud');
  });

  it('renders direct URL for http:// prefix', () => {
    const wrapper = factory({ icon: 'http://example.com/icon.png' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('http://example.com/icon.png');
  });

  it('renders direct URL for https:// prefix', () => {
    const wrapper = factory({ icon: 'https://example.com/icon.png' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('https://example.com/icon.png');
  });

  it('renders unknown strings as selfhst proxy slug', () => {
    const wrapper = factory({ icon: 'unknown-thing' });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/v1/icons/selfhst/unknown-thing');
  });

  it('renders AppIcon fallback for empty icon after error', async () => {
    const wrapper = factory({ icon: '' });
    // Initially renders img (with undefined src) because failed is false
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    // Trigger error to switch to AppIcon fallback
    await img.trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.app-icon-stub').exists()).toBe(true);
  });

  it('shows AppIcon fallback on image load error', async () => {
    const wrapper = factory({ icon: 'sh-broken' });
    expect(wrapper.find('img').exists()).toBe(true);
    await wrapper.find('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.app-icon-stub').exists()).toBe(true);
  });

  it('applies the default size of 20', () => {
    const wrapper = factory({ icon: 'sh-test' });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 20px');
    expect(root.attributes('style')).toContain('height: 20px');
  });

  it('applies a custom size prop', () => {
    const wrapper = factory({ icon: 'sh-test', size: 32 });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 32px');
    expect(root.attributes('style')).toContain('height: 32px');
  });

  it('sets lazy loading on proxy images', () => {
    const wrapper = factory({ icon: 'sh-test' });
    expect(wrapper.find('img').attributes('loading')).toBe('lazy');
  });

  it('sets lazy loading on URL images', () => {
    const wrapper = factory({ icon: 'https://example.com/img.png' });
    expect(wrapper.find('img').attributes('loading')).toBe('lazy');
  });

  it('applies size to proxy image container', () => {
    const wrapper = factory({ icon: 'sh-docker', size: 28 });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 28px');
    expect(root.attributes('style')).toContain('height: 28px');
  });

  it('applies size to fallback container', () => {
    const wrapper = factory({ icon: '', size: 36 });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 36px');
    expect(root.attributes('style')).toContain('height: 36px');
  });
});
