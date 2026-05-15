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

  afterEach(() => {
    document.body.innerHTML = '';
  });

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

  it('renders icon-only button that opens structured release notes when iconOnly is true', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });
    const trigger = wrapper.find('[data-test="release-notes-link"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('aria-label')).toBe('Release notes');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    await trigger.trigger('click');
    await nextTick();

    const popover = document.body.querySelector('[data-test="release-notes-popover"]');
    expect(popover?.textContent).toContain('Release notes - v2.0.0 Release');
    expect(trigger.attributes('aria-expanded')).toBe('true');

    wrapper.unmount();
  });

  it('icon-only popover expands preview and keeps the full-notes link inside the panel', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });

    await wrapper.find('[data-test="release-notes-link"]').trigger('click');
    await nextTick();
    const panel = document.body.querySelector('[data-test="update-release-notes-panel"]');
    const button = panel?.querySelector('button');
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(panel?.textContent).toContain(sampleNotes.body);
    const link = panel?.querySelector('a');
    expect(link?.textContent).toContain('View full notes');
    expect(link?.getAttribute('href')).toBe(sampleNotes.url);

    wrapper.unmount();
  });

  it('renders icon-only button with popover when only releaseLink is provided and iconOnly is true', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseLink: 'https://example.com/releases', iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });
    const trigger = wrapper.find('[data-test="release-link"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.element.tagName).toBe('BUTTON');
    expect(trigger.attributes('aria-haspopup')).toBe('dialog');
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    await trigger.trigger('click');
    await nextTick();

    const popover = document.body.querySelector('[data-test="release-notes-popover"]');
    expect(popover).not.toBeNull();
    const linkRow = popover?.querySelector(
      '[data-test="release-link-row"]',
    ) as HTMLAnchorElement | null;
    expect(linkRow).not.toBeNull();
    expect(linkRow?.getAttribute('href')).toBe('https://example.com/releases');
    expect(linkRow?.getAttribute('target')).toBe('_blank');
    expect(linkRow?.getAttribute('rel')).toContain('noopener');
    expect(linkRow?.getAttribute('rel')).toContain('noreferrer');

    wrapper.unmount();
  });

  it('clicking the release-link-row closes the popover', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseLink: 'https://example.com/releases', iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });

    // Open the popover first
    await wrapper.find('[data-test="release-link"]').trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).not.toBeNull();

    // Click the link row — should close the popover
    const linkRow = document.body.querySelector(
      '[data-test="release-link-row"]',
    ) as HTMLElement | null;
    expect(linkRow).not.toBeNull();
    linkRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    wrapper.unmount();
  });

  describe('currentReleaseNotes (current running tag)', () => {
    const currentNotes = {
      title: 'v1.5.0 Release',
      body: 'Notes for the version currently running.',
      url: 'https://github.com/example/repo/releases/tag/v1.5.0',
      publishedAt: '2026-01-01T00:00:00Z',
      provider: 'github',
    };

    it('renders only the current panel when no update notes are present', () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: { currentReleaseNotes: currentNotes },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="current-release-notes-panel"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="update-release-notes-panel"]').exists()).toBe(false);
    });

    it('labels the current panel with the running tag title', () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: { currentReleaseNotes: currentNotes },
        global: globalConfig,
      });
      const button = wrapper.find('[data-test="current-release-notes-panel"] button');
      expect(button.text()).toContain('Release notes — v1.5.0 Release (current)');
    });

    it('expanding the current panel reveals title, body, and view-full link', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: { currentReleaseNotes: currentNotes },
        global: globalConfig,
      });
      const button = wrapper.find('[data-test="current-release-notes-panel"] button');
      await button.trigger('click');
      await nextTick();
      expect(wrapper.text()).toContain(currentNotes.title);
      expect(wrapper.text()).toContain(currentNotes.body);
      const fullLink = wrapper
        .find('[data-test="current-release-notes-panel"]')
        .findAll('a')
        .find((a) => a.attributes('href') === currentNotes.url);
      expect(fullLink).toBeDefined();
    });

    it('renders both panels when current and update notes differ', () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: currentNotes,
          releaseNotes: sampleNotes,
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="current-release-notes-panel"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="update-release-notes-panel"]').exists()).toBe(true);
    });

    it('update panel labels itself "(available)" when current panel also renders', () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: currentNotes,
          releaseNotes: sampleNotes,
        },
        global: globalConfig,
      });
      const updateButton = wrapper.find('[data-test="update-release-notes-panel"] button');
      expect(updateButton.text()).toContain(`Release notes — ${sampleNotes.title} (available)`);
    });

    it('hides the current panel when current and update notes share a URL', () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: { ...sampleNotes },
          releaseNotes: sampleNotes,
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="current-release-notes-panel"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="update-release-notes-panel"]').exists()).toBe(true);
    });

    it('hides the current panel when current and update notes share a title', () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: { ...sampleNotes, url: 'https://other-url.example/v2.0.0' },
          releaseNotes: sampleNotes,
        },
        global: globalConfig,
      });
      expect(wrapper.find('[data-test="current-release-notes-panel"]').exists()).toBe(false);
    });

    it('icon-only shows both current and available notes in the popover', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: currentNotes,
          releaseNotes: sampleNotes,
          iconOnly: true,
        },
        global: globalConfig,
        attachTo: document.body,
      });
      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();

      const popover = document.body.querySelector('[data-test="release-notes-popover"]');
      expect(popover?.textContent).toContain('Release notes - v1.5.0 Release (current)');
      expect(popover?.textContent).toContain('Release notes - v2.0.0 Release (available)');

      wrapper.unmount();
    });

    it('icon-only falls back to currentReleaseNotes when releaseNotes is absent', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: currentNotes,
          iconOnly: true,
        },
        global: globalConfig,
        attachTo: document.body,
      });
      const trigger = wrapper.find('[data-test="current-release-notes-link"]');
      expect(trigger.exists()).toBe(true);
      expect(trigger.element.tagName).toBe('BUTTON');

      await trigger.trigger('click');
      await nextTick();

      const popover = document.body.querySelector('[data-test="release-notes-popover"]');
      expect(popover?.textContent).toContain('Release notes - v1.5.0 Release (current)');

      wrapper.unmount();
    });

    it('expanding update panel does not affect current panel state when both rendered', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: currentNotes,
          releaseNotes: sampleNotes,
        },
        global: globalConfig,
      });
      const updateButton = wrapper.find('[data-test="update-release-notes-panel"] button');
      await updateButton.trigger('click');
      await nextTick();
      expect(wrapper.find('[data-test="update-release-notes-panel"]').text()).toContain(
        sampleNotes.title,
      );
      // Current panel stays collapsed: its body should not be in the document
      expect(wrapper.find('[data-test="current-release-notes-panel"]').text()).not.toContain(
        currentNotes.body,
      );
    });

    it('icon-only popover expands the current-notes panel when clicked', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          currentReleaseNotes: currentNotes,
          releaseNotes: sampleNotes,
          iconOnly: true,
        },
        global: globalConfig,
        attachTo: document.body,
      });

      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();

      const currentPanel = document.body.querySelector('[data-test="current-release-notes-panel"]');
      const currentButton = currentPanel?.querySelector('button');
      expect(currentButton).not.toBeNull();

      currentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await nextTick();

      expect(currentPanel?.textContent).toContain(currentNotes.body);

      wrapper.unmount();
    });
  });

  it('toggleIconPopover closes the popover when it is already open', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });
    const trigger = wrapper.find('[data-test="release-notes-link"]');

    // Open the popover
    await trigger.trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).not.toBeNull();

    // Click again — should close via toggleIconPopover's close branch
    await trigger.trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    wrapper.unmount();
  });

  it('pressing Escape closes an open icon-only popover', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });

    await wrapper.find('[data-test="release-notes-link"]').trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).not.toBeNull();

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    wrapper.unmount();
  });

  it('pressing a non-Escape key does not close the popover', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });

    await wrapper.find('[data-test="release-notes-link"]').trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).not.toBeNull();

    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).not.toBeNull();

    wrapper.unmount();
  });

  it('closeIconPopover is a no-op when the popover is already closed', async () => {
    const wrapper = mount(ReleaseNotesLink, {
      props: { releaseNotes: sampleNotes, iconOnly: true },
      global: globalConfig,
      attachTo: document.body,
    });

    // Popover starts closed — clicking the global handler (registered after open) should not throw
    // Open then close cleanly first
    await wrapper.find('[data-test="release-notes-link"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-test="release-notes-link"]').trigger('click');
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    // Calling close again (when already closed) must be safe — exercises the early-return branch
    globalThis.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[data-test="release-notes-popover"]')).toBeNull();

    wrapper.unmount();
  });
});
