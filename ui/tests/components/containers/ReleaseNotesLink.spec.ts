import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ReleaseNotesLink from '@/components/containers/ReleaseNotesLink.vue';

describe('ReleaseNotesLink', () => {
  const globalConfig = {
    stubs: { AppIcon: { template: '<span />', props: ['name', 'size'] } },
  };

  const sampleNotes = {
    title: 'v2.0.0 Release',
    body: 'This is the release body with some details about the release.',
    url: 'https://github.com/example/repo/releases/tag/v2.0.0',
    publishedAt: '2026-03-10T12:00:00Z',
    provider: 'github',
  };

  const longBody = 'A'.repeat(250);

  it('renders nothing when neither releaseNotes nor releaseLink is provided', () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: {},
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="release-notes-link"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="release-link"]').exists()).toBe(false);
  });

  it('shows simple link with href when only releaseLink is provided', () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseLink: 'https://github.com/example/repo/releases' },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="release-notes-link"]').exists()).toBe(false);
    const link = wrapper.find('[data-test="release-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://github.com/example/repo/releases');
    expect(link.text()).toContain('Release notes');
  });

  it('shows expandable button when releaseNotes is provided', () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes },
      global: globalConfig,
    });
    const container = wrapper.find('[data-test="release-notes-link"]');
    expect(container.exists()).toBe(true);
    const button = container.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('Release notes');
  });

  it('click toggles inline preview content', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes },
      global: globalConfig,
    });
    const button = wrapper.find('[data-test="release-notes-link"] button');

    // Initially collapsed — no preview content
    expect(wrapper.text()).not.toContain(sampleNotes.title);

    // Expand
    await button.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain(sampleNotes.title);
    expect(wrapper.text()).toContain(sampleNotes.body);

    // Collapse
    await button.trigger('click');
    await nextTick();
    expect(wrapper.text()).not.toContain(sampleNotes.title);
  });

  it('preview shows title and truncated body', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: {
        releaseNotes: { ...sampleNotes, body: longBody },
      },
      global: globalConfig,
    });
    await wrapper.find('[data-test="release-notes-link"] button').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain(sampleNotes.title);
    // Body should be truncated to 200 chars + "..."
    expect(wrapper.text()).toContain('A'.repeat(200));
    expect(wrapper.text()).toContain('...');
    // Full body (250 chars) should NOT appear
    expect(wrapper.text()).not.toContain(longBody);
  });

  it('preview includes "View full notes" link with correct url', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes },
      global: globalConfig,
    });
    await wrapper.find('[data-test="release-notes-link"] button').trigger('click');
    await nextTick();

    const viewLink = wrapper.find('[data-test="release-notes-link"] a');
    expect(viewLink.exists()).toBe(true);
    expect(viewLink.text()).toContain('View full notes');
    expect(viewLink.attributes('href')).toBe(sampleNotes.url);
    expect(viewLink.attributes('target')).toBe('_blank');
  });

  it('body is truncated at 200 chars with ellipsis', async () => {
    const exactBody = 'B'.repeat(200);
    const wrapper = mount(ReleaseNotesLink, {
      props: {
        releaseNotes: { ...sampleNotes, body: exactBody },
      },
      global: globalConfig,
    });
    await wrapper.find('[data-test="release-notes-link"] button').trigger('click');
    await nextTick();

    // Exactly 200 chars should NOT be truncated
    expect(wrapper.text()).toContain(exactBody);
    expect(wrapper.text()).not.toContain('...');
  });

  it('renders nothing in iconOnly mode when neither releaseNotes nor releaseLink is provided', () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { iconOnly: true },
      global: globalConfig,
    });
    expect(wrapper.find('[data-test="release-notes-link"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="release-link"]').exists()).toBe(false);
  });

  it('renders icon-only anchor linking to releaseNotes.url when iconOnly is true', () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
    });
    const link = wrapper.find('[data-test="release-notes-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe(sampleNotes.url);
    expect(link.attributes('aria-label')).toBe('Release notes');
    expect(link.element.tagName).toBe('A');
    expect(link.text()).not.toContain('Release notes');
  });

  it('renders icon-only anchor linking to releaseLink fallback when iconOnly is true', () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseLink: 'https://example.com/releases', iconOnly: true },
      global: globalConfig,
    });
    const link = wrapper.find('[data-test="release-link"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('https://example.com/releases');
    expect(link.attributes('aria-label')).toBe('Release notes');
  });
});
