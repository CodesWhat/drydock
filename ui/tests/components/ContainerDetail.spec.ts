import { mount } from '@vue/test-utils';
import ContainerDetail from '@/components/ContainerDetail';

const mockContainer = {
  id: 'abc123',
  name: 'my-container',
  status: 'running',
  watcher: 'local',
  includeTags: '^v\\d+',
  excludeTags: '.*-beta',
  transformTags: 's/^v//',
  linkTemplate: 'https://example.com/${tag}',
  link: 'https://example.com/1.0.0',
};

describe('ContainerDetail', () => {
  let wrapper: any;

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    wrapper = mount(ContainerDetail, {
      props: { container: mockContainer },
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders container id', () => {
    expect(wrapper.text()).toContain('abc123');
  });

  it('renders container name', () => {
    expect(wrapper.text()).toContain('my-container');
  });

  it('renders container status', () => {
    expect(wrapper.text()).toContain('running');
  });

  it('renders watcher with router-link', () => {
    expect(wrapper.text()).toContain('local');
  });

  it('renders includeTags when present', () => {
    expect(wrapper.text()).toContain('^v\\d+');
  });

  it('renders excludeTags when present', () => {
    expect(wrapper.text()).toContain('.*-beta');
  });

  it('renders transformTags when present', () => {
    expect(wrapper.text()).toContain('s/^v//');
  });

  it('renders linkTemplate when present', () => {
    expect(wrapper.text()).toContain('https://example.com/${tag}');
  });

  it('renders link when present', () => {
    expect(wrapper.text()).toContain('https://example.com/1.0.0');
  });

  it('hides includeTags when not present', async () => {
    const { includeTags, ...containerWithout } = mockContainer;
    await wrapper.setProps({ container: containerWithout });
    expect(wrapper.text()).toContain('Id');
    expect(wrapper.text()).not.toContain('Include tags');
  });

  it('hides excludeTags when not present', async () => {
    const { excludeTags, ...containerWithout } = mockContainer;
    await wrapper.setProps({ container: containerWithout });
    expect(wrapper.text()).not.toContain('Exclude tags');
  });

  it('hides transformTags when not present', async () => {
    const { transformTags, ...containerWithout } = mockContainer;
    await wrapper.setProps({ container: containerWithout });
    expect(wrapper.text()).not.toContain('Transform tags');
  });

  it('hides linkTemplate when not present', async () => {
    const { linkTemplate, ...containerWithout } = mockContainer;
    await wrapper.setProps({ container: containerWithout });
    expect(wrapper.text()).not.toContain('Link template');
  });

  it('hides link when not present', async () => {
    const { link, ...containerWithout } = mockContainer;
    await wrapper.setProps({ container: containerWithout });
    // "Link template" may still be present, but standalone "Link" list item should not
    const linkItems = wrapper.findAll('.v-list-item').filter((w: any) => {
      const title = w.find('.v-list-item-title');
      return title && title.text() === 'Link';
    });
    expect(linkItems.length).toBe(0);
  });

  it('copies container id to clipboard', async () => {
    await wrapper.vm.copyToClipboard('container id', 'abc123');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('abc123');
  });

  it('emits notify event after copying to clipboard', async () => {
    await wrapper.vm.copyToClipboard('container id', 'abc123');
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'container id copied to clipboard'
    );
  });
});
