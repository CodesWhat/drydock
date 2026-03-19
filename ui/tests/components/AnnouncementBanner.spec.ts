import { mount } from '@vue/test-utils';
import AnnouncementBanner from '@/components/AnnouncementBanner.vue';

const stubs = {
  AppIcon: { template: '<span />', props: ['name', 'size'] },
};

function factory(props: Record<string, unknown> = {}, attrs: Record<string, string> = {}) {
  return mount(AnnouncementBanner, {
    props: { title: 'Maintenance Notice', ...props },
    attrs,
    slots: { default: 'Dashboard updates may be delayed.' },
    global: { stubs },
  });
}

describe('AnnouncementBanner', () => {
  it('renders title and slot content', () => {
    const wrapper = factory();

    expect(wrapper.text()).toContain('Maintenance Notice');
    expect(wrapper.text()).toContain('Dashboard updates may be delayed.');
  });

  it('uses warning icon by default', () => {
    const wrapper = factory();
    const icon = wrapper.findComponent(stubs.AppIcon);

    expect(icon.props('name')).toBe('warning');
    expect(icon.props('size')).toBe(14);
  });

  it('uses custom icon when provided', () => {
    const wrapper = factory({ icon: 'info' });
    const icon = wrapper.findComponent(stubs.AppIcon);

    expect(icon.props('name')).toBe('info');
  });

  it('uses error styling when tone is error', () => {
    const wrapper = factory({ tone: 'error' });
    expect(wrapper.attributes('style')).toContain('var(--dd-danger)');
    expect(wrapper.attributes('style')).not.toContain('var(--dd-warning)');
  });

  it('renders only the session dismiss action by default', () => {
    const wrapper = factory();
    const buttons = wrapper.findAll('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0].text()).toBe('Dismiss');
  });

  it('renders custom dismiss labels and permanent action when configured', () => {
    const wrapper = factory({
      dismissLabel: 'Not now',
      permanentDismissLabel: 'Dismiss forever',
    });
    const buttons = wrapper.findAll('button');

    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toBe('Not now');
    expect(buttons[1].text()).toBe('Dismiss forever');
  });

  it('emits dismiss when the session dismiss button is clicked', async () => {
    const wrapper = factory({}, { 'data-testid': 'announcement' });

    await wrapper.get('[data-testid="announcement-dismiss-session"]').trigger('click');

    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('emits dismiss-permanent when the permanent dismiss button is clicked', async () => {
    const wrapper = factory(
      { permanentDismissLabel: 'Dismiss forever' },
      { 'data-testid': 'announcement' },
    );

    await wrapper.get('[data-testid="announcement-dismiss-forever"]').trigger('click');

    expect(wrapper.emitted('dismiss-permanent')).toHaveLength(1);
  });

  it('adds action data-testids from the provided data-testid attr', () => {
    const wrapper = factory(
      { permanentDismissLabel: 'Dismiss forever' },
      { 'data-testid': 'announcement' },
    );

    expect(wrapper.find('[data-testid="announcement-dismiss-session"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="announcement-dismiss-forever"]').exists()).toBe(true);
  });
});
