import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import AppIcon from '@/components/AppIcon.vue';
import AppIconButton from '@/components/AppIconButton.vue';

const mockIcon = vi.fn((name: string) => `resolved:${name}`);
const mockIconScale = ref(1);

vi.mock('@/composables/useIcons', () => ({
  useIcons: () => ({ icon: mockIcon, iconScale: mockIconScale }),
}));

const tooltipStub = () => {};

function mountButton(props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  return mount(AppIconButton, {
    props: { icon: 'edit', ...props },
    attrs,
    global: {
      directives: { tooltip: tooltipStub },
    },
  });
}

describe('AppIconButton', () => {
  beforeEach(() => {
    mockIcon.mockImplementation((name: string) => `resolved:${name}`);
    mockIconScale.value = 1;
  });

  // 1. Default props
  it('renders with default props (size=sm, variant=muted)', () => {
    const wrapper = mountButton();
    const button = wrapper.get('button');

    expect(button.classes()).toContain('w-10');
    expect(button.classes()).toContain('h-10');
    expect(button.classes()).toContain('dd-text-muted');
    expect(button.classes()).toContain('hover:dd-text');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
    expect(button.classes()).toContain('inline-flex');
    expect(button.classes()).toContain('items-center');
    expect(button.classes()).toContain('justify-center');
    expect(button.classes()).toContain('dd-rounded');
    expect(button.classes()).toContain('transition-colors');
  });

  // 2. Size classes
  it('applies xs size classes (w-9 h-9)', () => {
    const wrapper = mountButton({ size: 'xs' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('w-9');
    expect(button.classes()).toContain('h-9');
  });

  it('applies sm size classes (w-10 h-10)', () => {
    const wrapper = mountButton({ size: 'sm' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('w-10');
    expect(button.classes()).toContain('h-10');
  });

  it('applies md size classes (w-11 h-11)', () => {
    const wrapper = mountButton({ size: 'md' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('w-11');
    expect(button.classes()).toContain('h-11');
  });

  it('applies lg size classes (w-12 h-12)', () => {
    const wrapper = mountButton({ size: 'lg' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('w-12');
    expect(button.classes()).toContain('h-12');
  });

  // 3. Icon sizes
  it('passes icon size 14 for xs', () => {
    const wrapper = mountButton({ size: 'xs' });
    const icon = wrapper.findComponent(AppIcon);
    expect(icon.props('size')).toBe(14);
  });

  it('passes icon size 16 for sm', () => {
    const wrapper = mountButton({ size: 'sm' });
    const icon = wrapper.findComponent(AppIcon);
    expect(icon.props('size')).toBe(16);
  });

  it('passes icon size 18 for md', () => {
    const wrapper = mountButton({ size: 'md' });
    const icon = wrapper.findComponent(AppIcon);
    expect(icon.props('size')).toBe(18);
  });

  it('passes icon size 20 for lg', () => {
    const wrapper = mountButton({ size: 'lg' });
    const icon = wrapper.findComponent(AppIcon);
    expect(icon.props('size')).toBe(20);
  });

  // 4. Variant classes
  it('applies muted variant classes', () => {
    const wrapper = mountButton({ variant: 'muted' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('dd-text-muted');
    expect(button.classes()).toContain('hover:dd-text');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
  });

  it('applies secondary variant classes', () => {
    const wrapper = mountButton({ variant: 'secondary' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('dd-text-secondary');
    expect(button.classes()).toContain('hover:dd-text');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
  });

  it('applies danger variant classes', () => {
    const wrapper = mountButton({ variant: 'danger' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('dd-text-muted');
    expect(button.classes()).toContain('hover:dd-text-danger');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
  });

  it('applies success variant classes', () => {
    const wrapper = mountButton({ variant: 'success' });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('dd-text-muted');
    expect(button.classes()).toContain('hover:dd-text-success');
    expect(button.classes()).toContain('hover:dd-bg-elevated');
  });

  it('applies plain variant with no extra classes', () => {
    const wrapper = mountButton({ variant: 'plain' });
    const button = wrapper.get('button');
    expect(button.classes()).not.toContain('dd-text-muted');
    expect(button.classes()).not.toContain('dd-text-secondary');
    expect(button.classes()).not.toContain('hover:dd-text-danger');
    expect(button.classes()).not.toContain('hover:dd-text-success');
  });

  // 5. Loading state — spinner
  it('renders spinner icon with dd-spin class when loading is true', () => {
    const wrapper = mountButton({ loading: true });
    const icon = wrapper.findComponent(AppIcon);
    expect(icon.props('name')).toBe('spinner');
    expect(icon.classes()).toContain('dd-spin');
  });

  // 6. Normal icon when not loading
  it('renders the provided icon when loading is false', () => {
    const wrapper = mountButton({ icon: 'trash', loading: false });
    const icon = wrapper.findComponent(AppIcon);
    expect(icon.props('name')).toBe('trash');
    expect(icon.classes()).not.toContain('dd-spin');
  });

  // 7. Disabled state
  it('applies disabled classes when disabled is true', () => {
    const wrapper = mountButton({ disabled: true });
    const button = wrapper.get('button');
    expect(button.classes()).toContain('opacity-40');
    expect(button.classes()).toContain('cursor-not-allowed');
    expect(button.classes()).toContain('pointer-events-none');
    expect(button.attributes('disabled')).toBeDefined();
  });

  it('does not apply disabled classes when disabled is false', () => {
    const wrapper = mountButton({ disabled: false });
    const button = wrapper.get('button');
    expect(button.classes()).not.toContain('opacity-40');
    expect(button.classes()).not.toContain('cursor-not-allowed');
    expect(button.classes()).not.toContain('pointer-events-none');
  });

  // 8. aria-label from ariaLabel prop
  it('sets aria-label from ariaLabel prop', () => {
    const wrapper = mountButton({ ariaLabel: 'Delete item' });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Delete item');
  });

  // 9. Falls back to tooltip for aria-label
  it('falls back to tooltip for aria-label when ariaLabel is not set', () => {
    const wrapper = mountButton({ tooltip: 'Edit record' });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Edit record');
  });

  it('prefers ariaLabel over tooltip for aria-label', () => {
    const wrapper = mountButton({
      ariaLabel: 'Custom label',
      tooltip: 'Tooltip text',
    });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Custom label');
  });

  // 10. Forwards attrs to button element
  it('forwards attrs to the button element', () => {
    const wrapper = mountButton({}, { 'data-test': 'icon-btn', id: 'my-btn' });
    const button = wrapper.get('button');
    expect(button.attributes('data-test')).toBe('icon-btn');
    expect(button.attributes('id')).toBe('my-btn');
  });

  // 11. Button type
  it('sets button type="button"', () => {
    const wrapper = mountButton();
    expect(wrapper.get('button').attributes('type')).toBe('button');
  });
});
