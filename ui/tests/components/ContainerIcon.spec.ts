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

  it('renders FontAwesome <i> tag for fa prefix', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'fas fa-server' } });
    expect(wrapper.find('img').exists()).toBe(false);
    const icon = wrapper.find('i');
    expect(icon.exists()).toBe(true);
    expect(icon.classes()).toContain('fas');
  });

  it('renders Docker fallback <i> tag for unknown icon', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'unknown-thing' } });
    expect(wrapper.find('img').exists()).toBe(false);
    const icon = wrapper.find('i');
    expect(icon.exists()).toBe(true);
    expect(icon.classes()).toContain('fab');
    expect(icon.classes()).toContain('fa-docker');
  });

  it('renders Docker fallback for empty icon string', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: '' } });
    const icon = wrapper.find('i');
    expect(icon.exists()).toBe(true);
    expect(icon.classes()).toContain('fa-docker');
  });

  it('shows Docker fallback on image load error', async () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'sh-broken' } });
    expect(wrapper.find('img').exists()).toBe(true);
    await wrapper.find('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    const fallback = wrapper.find('i');
    expect(fallback.exists()).toBe(true);
    expect(fallback.classes()).toContain('fa-docker');
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

  it('applies size to FontAwesome icon fontSize', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: 'fas fa-cog', size: 28 } });
    const icon = wrapper.find('i');
    expect(icon.attributes('style')).toContain('font-size: 28px');
  });

  it('applies size to Docker fallback fontSize', () => {
    const wrapper = mount(ContainerIcon, { props: { icon: '', size: 36 } });
    const icon = wrapper.find('i');
    expect(icon.attributes('style')).toContain('font-size: 36px');
  });
});
