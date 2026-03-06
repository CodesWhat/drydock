import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';

const mockIcon = vi.fn((name: string) => `resolved:${name}`);
const mockIconScale = ref(1);

vi.mock('@/composables/useIcons', () => ({
  useIcons: () => ({ icon: mockIcon, iconScale: mockIconScale }),
}));

describe('AppIcon', () => {
  beforeEach(() => {
    mockIcon.mockImplementation((name: string) => `resolved:${name}`);
    mockIconScale.value = 1;
  });

  it('renders an iconify-icon element', () => {
    const wrapper = mount(AppIcon, { props: { name: 'dashboard' } });
    expect(wrapper.find('iconify-icon').exists()).toBe(true);
  });

  it('passes the resolved icon name to iconify-icon', () => {
    const wrapper = mount(AppIcon, { props: { name: 'dashboard' } });
    expect(wrapper.find('iconify-icon').attributes('icon')).toBe('resolved:dashboard');
  });

  it('resolves different icon names correctly', () => {
    const wrapper = mount(AppIcon, { props: { name: 'settings' } });
    expect(wrapper.find('iconify-icon').attributes('icon')).toBe('resolved:settings');
    expect(mockIcon).toHaveBeenCalledWith('settings');
  });

  it('applies the default size of 16 scaled by iconScale', () => {
    const wrapper = mount(AppIcon, { props: { name: 'test' } });
    const el = wrapper.find('iconify-icon');
    expect(el.attributes('width')).toBe('16');
    expect(el.attributes('height')).toBe('16');
  });

  it('applies custom size prop', () => {
    const wrapper = mount(AppIcon, { props: { name: 'test', size: 24 } });
    const el = wrapper.find('iconify-icon');
    expect(el.attributes('width')).toBe('24');
    expect(el.attributes('height')).toBe('24');
  });

  it('scales size by iconScale factor', async () => {
    mockIconScale.value = 1.5;
    const wrapper = mount(AppIcon, { props: { name: 'test', size: 20 } });
    await wrapper.vm.$nextTick();
    const el = wrapper.find('iconify-icon');
    expect(el.attributes('width')).toBe('30');
    expect(el.attributes('height')).toBe('30');
  });

  it('rounds scaled size to nearest integer', async () => {
    mockIconScale.value = 1.3;
    const wrapper = mount(AppIcon, { props: { name: 'test', size: 10 } });
    await wrapper.vm.$nextTick();
    const el = wrapper.find('iconify-icon');
    expect(el.attributes('width')).toBe('13');
    expect(el.attributes('height')).toBe('13');
  });

  it('calls the icon resolver from useIcons', () => {
    mount(AppIcon, { props: { name: 'container' } });
    expect(mockIcon).toHaveBeenCalledWith('container');
  });
});
