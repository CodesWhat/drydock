import { mount } from '@vue/test-utils';
import ContainerIcon from '@/components/ContainerIcon.vue';

describe('ContainerIcon', () => {
  it('renders selfhst proxy img for sh- prefix', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-nginx' } });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/icons/selfhst/nginx');
  });

  it('renders homarr proxy img for hl- prefix', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'hl-portainer' } });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/icons/homarr/portainer');
  });

  it('renders simple-icons proxy img for si- prefix', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'si-docker' } });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/icons/simple/docker');
  });

  it('renders direct URL for http:// prefix', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'http://example.com/icon.png' } });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('http://example.com/icon.png');
  });

  it('renders direct URL for https:// prefix', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'https://example.com/icon.png' } });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('https://example.com/icon.png');
  });

  it('renders unknown strings as selfhst proxy slug', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'unknown-thing' } });
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('/api/icons/selfhst/unknown-thing');
  });

  it('renders AppIcon fallback for empty icon after error', async () => {
    const wrapper = mount(ContainerIcon, { props: { icon: '' } });
    // Initially renders img (with undefined src) because failed is false
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    // Trigger error to switch to AppIcon fallback
    await img.trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.html()).toContain('appicon');
  });

  it('shows AppIcon fallback on image load error', async () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-broken' } });
    expect(wrapper.find('img').exists()).toBe(true);
    await wrapper.find('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.html()).toContain('appicon');
  });

  it('applies the default size of 20', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-test' } });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 20px');
    expect(root.attributes('style')).toContain('height: 20px');
  });

  it('applies a custom size prop', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-test', size: 32 } });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 32px');
    expect(root.attributes('style')).toContain('height: 32px');
  });

  it('sets lazy loading on proxy images', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-test' } });
    expect(wrapper.find('img').attributes('loading')).toBe('lazy');
  });

  it('sets lazy loading on URL images', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'https://example.com/img.png' } });
    expect(wrapper.find('img').attributes('loading')).toBe('lazy');
  });

  it('applies size to proxy image container', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-docker', size: 28 } });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 28px');
    expect(root.attributes('style')).toContain('height: 28px');
  });

  it('applies size to fallback container', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: '', size: 36 } });
    const root = wrapper.find('div');
    expect(root.attributes('style')).toContain('width: 36px');
    expect(root.attributes('style')).toContain('height: 36px');
  });
});
