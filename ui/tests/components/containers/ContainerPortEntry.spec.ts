import { defineComponent } from 'vue';
import ContainerPortEntry from '@/components/containers/ContainerPortEntry.vue';
import { mountWithPlugins } from '../../helpers/mount';

describe('ContainerPortEntry', () => {
  it('renders an anchor with the href, target, rel, and label text when href is set', () => {
    const wrapper = mountWithPlugins(ContainerPortEntry, {
      props: { href: 'http://example.test:8080', label: '8080->80/tcp' },
    });

    const link = wrapper.get('[data-test="container-port-link"]');
    expect(link.element.tagName).toBe('A');
    expect(link.attributes('href')).toBe('http://example.test:8080');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.text()).toBe('8080->80/tcp');
    expect(wrapper.find('[data-test="container-port-text"]').exists()).toBe(false);
  });

  it('applies min-w-0 to the link so long labels ellipsize instead of overflowing the flex row', () => {
    const wrapper = mountWithPlugins(ContainerPortEntry, {
      props: { href: 'http://example.test:8080', label: '8080->80/tcp' },
    });

    const link = wrapper.get('[data-test="container-port-link"]');
    expect(link.classes()).toContain('min-w-0');
    expect(link.classes()).toContain('truncate');
  });

  it('renders a span with the label text and no anchor when href is absent', () => {
    const wrapper = mountWithPlugins(ContainerPortEntry, {
      props: { label: '443/tcp' },
    });

    const text = wrapper.get('[data-test="container-port-text"]');
    expect(text.element.tagName).toBe('SPAN');
    expect(text.text()).toBe('443/tcp');
    expect(wrapper.find('[data-test="container-port-link"]').exists()).toBe(false);
  });

  it('applies min-w-0 to the fallback span so long labels ellipsize instead of overflowing the flex row', () => {
    const wrapper = mountWithPlugins(ContainerPortEntry, {
      props: { label: '443/tcp' },
    });

    const text = wrapper.get('[data-test="container-port-text"]');
    expect(text.classes()).toContain('min-w-0');
    expect(text.classes()).toContain('truncate');
  });

  it('stops click propagation on the link so it does not activate a clickable parent row', async () => {
    const parentClick = vi.fn();
    const Host = defineComponent({
      components: { ContainerPortEntry },
      setup() {
        return { parentClick };
      },
      template: `
        <div data-test="clickable-row" @click="parentClick">
          <ContainerPortEntry href="http://example.test:8080" label="8080->80/tcp" />
        </div>
      `,
    });
    const wrapper = mountWithPlugins(Host);

    await wrapper.get('[data-test="container-port-link"]').trigger('click');

    expect(parentClick).not.toHaveBeenCalled();
  });
});
