import { mount } from '@vue/test-utils';
import ContainerDetail from '@/components/ContainerDetail.vue';

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
      'container id copied to clipboard',
    );
  });

  it('invokes copy handler from container id button click', async () => {
    const copySpy = vi.spyOn(wrapper.vm, 'copyToClipboard');
    const button = wrapper.find('.v-btn');
    await button.trigger('click');
    expect(copySpy).toHaveBeenCalledWith('container id', 'abc123');
  });

  describe('Lifecycle Hooks', () => {
    it('hides hooks section when no hook labels exist', () => {
      expect(wrapper.text()).not.toContain('Lifecycle Hooks');
    });

    it('shows hooks section when pre hook label exists', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.hook.pre': 'echo pre-update' },
        },
      });
      expect(wrapper.text()).toContain('Lifecycle Hooks');
      expect(wrapper.text()).toContain('pre');
      expect(wrapper.text()).toContain('echo pre-update');
    });

    it('shows hooks section when post hook label exists', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.hook.post': 'echo post-update' },
        },
      });
      expect(wrapper.text()).toContain('Lifecycle Hooks');
      expect(wrapper.text()).toContain('post');
      expect(wrapper.text()).toContain('echo post-update');
    });

    it('displays both pre and post hooks when both exist', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'dd.hook.pre': 'echo before',
            'dd.hook.post': 'echo after',
          },
        },
      });
      expect(wrapper.text()).toContain('echo before');
      expect(wrapper.text()).toContain('echo after');
    });

    it('shows aborts on fail chip when hookPreAbort is true (default)', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.hook.pre': 'echo test' },
        },
      });
      expect(wrapper.text()).toContain('aborts on fail');
    });

    it('hides aborts on fail chip when hookPreAbort is false', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'dd.hook.pre': 'echo test',
            'dd.hook.pre.abort': 'false',
          },
        },
      });
      expect(wrapper.text()).not.toContain('aborts on fail');
    });

    it('displays custom timeout when not default 60000', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'dd.hook.pre': 'echo test',
            'dd.hook.timeout': '30000',
          },
        },
      });
      expect(wrapper.text()).toContain('Timeout: 30s');
    });

    it('hides timeout when value is default 60000', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.hook.pre': 'echo test' },
        },
      });
      expect(wrapper.text()).not.toContain('Timeout:');
    });

    it('reads hooks from wud.hook.* labels as fallback', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'wud.hook.pre': 'echo wud-pre',
            'wud.hook.post': 'echo wud-post',
          },
        },
      });
      expect(wrapper.text()).toContain('echo wud-pre');
      expect(wrapper.text()).toContain('echo wud-post');
    });

    it('prefers dd.hook.* labels over wud.hook.* labels', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'dd.hook.pre': 'echo dd-pre',
            'wud.hook.pre': 'echo wud-pre',
          },
        },
      });
      expect(wrapper.text()).toContain('echo dd-pre');
      expect(wrapper.text()).not.toContain('echo wud-pre');
    });
  });

  describe('Auto-Rollback', () => {
    it('hides auto-rollback section when label not set', () => {
      expect(wrapper.text()).not.toContain('Auto-Rollback');
    });

    it('shows auto-rollback section when dd.rollback.auto=true', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.rollback.auto': 'true' },
        },
      });
      expect(wrapper.text()).toContain('Auto-Rollback');
      expect(wrapper.text()).toContain('enabled');
    });

    it('hides auto-rollback section when dd.rollback.auto=false', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.rollback.auto': 'false' },
        },
      });
      expect(wrapper.text()).not.toContain('Auto-Rollback');
    });

    it('displays rollback window and interval', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'dd.rollback.auto': 'true',
            'dd.rollback.window': '600000',
            'dd.rollback.interval': '20000',
          },
        },
      });
      expect(wrapper.text()).toContain('600s');
      expect(wrapper.text()).toContain('20s');
    });

    it('displays default values when only dd.rollback.auto is set', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: { 'dd.rollback.auto': 'true' },
        },
      });
      expect(wrapper.text()).toContain('300s');
      expect(wrapper.text()).toContain('10s');
    });

    it('reads from wud.rollback.* labels as fallback', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'wud.rollback.auto': 'true',
            'wud.rollback.window': '120000',
            'wud.rollback.interval': '5000',
          },
        },
      });
      expect(wrapper.text()).toContain('Auto-Rollback');
      expect(wrapper.text()).toContain('120s');
      expect(wrapper.text()).toContain('5s');
    });

    it('prefers dd.rollback.* labels over wud.rollback.* labels', async () => {
      await wrapper.setProps({
        container: {
          ...mockContainer,
          labels: {
            'dd.rollback.auto': 'true',
            'dd.rollback.window': '600000',
            'wud.rollback.window': '120000',
          },
        },
      });
      expect(wrapper.text()).toContain('600s');
      expect(wrapper.text()).not.toContain('120s');
    });
  });
});
