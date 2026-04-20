import { mount } from '@vue/test-utils';
import ProjectLink from '@/components/containers/ProjectLink.vue';

describe('ProjectLink', () => {
  const globalConfig = {
    stubs: { AppIcon: { template: '<span />', props: ['name', 'size'] } },
  };

  it('renders nothing when sourceRepo is undefined', () => {
    const wrapper = mount(ProjectLink, {
      props: {},
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="project-link"]').exists()).toBe(false);
  });

  it('renders nothing when sourceRepo is an empty string', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: '' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="project-link"]').exists()).toBe(false);
  });

  it('renders nothing when sourceRepo is whitespace-only', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: '   ' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="project-link"]').exists()).toBe(false);
  });

  it('renders github.com link with correct attributes', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: 'github.com/grafana/grafana' },
      global: globalConfig,
    });
    const link = wrapper.find('[data-test="project-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://github.com/grafana/grafana');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
  });

  it('renders gitlab.com link with correct href', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: 'gitlab.com/owner/repo' },
      global: globalConfig,
    });
    const link = wrapper.find('[data-test="project-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://gitlab.com/owner/repo');
  });

  it('renders generic/bitbucket host link with correct href', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: 'bitbucket.org/owner/repo' },
      global: globalConfig,
    });
    const link = wrapper.find('[data-test="project-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://bitbucket.org/owner/repo');
  });

  it('link text contains "View project"', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: 'github.com/foo/bar' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="project-link"]').text()).toContain('View project');
  });

  it('renders nothing in iconOnly mode when sourceRepo is empty', () => {
    const wrapper = mount(ProjectLink, {
      props: { iconOnly: true },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="project-link"]').exists()).toBe(false);
  });

  it('renders icon-only variant with aria-label and href when iconOnly is true', () => {
    const wrapper = mount(ProjectLink, {
      props: { sourceRepo: 'github.com/grafana/grafana', iconOnly: true },
      global: globalConfig,
    });
    const link = wrapper.find('[data-test="project-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('aria-label')).toBe('View project');
    expect(link.attributes('href')).toBe('https://github.com/grafana/grafana');
    expect(link.text()).not.toContain('View project');
  });
});
