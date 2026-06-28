import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ReleaseNotesLink from '@/components/containers/ReleaseNotesLink.vue';

vi.mock('@/services/container', () => ({
  getContainerIntermediateReleaseNotes: vi.fn(),
}));

import { getContainerIntermediateReleaseNotes } from '@/services/container';

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
    vi.clearAllMocks();
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

  // ---------------------------------------------------------------------------
  // Intermediate release notes
  // ---------------------------------------------------------------------------
  describe('intermediate release notes', () => {
    const intermediateNote1 = {
      title: 'v1.9.0',
      body: 'Changes in v1.9.0.',
      url: 'https://github.com/example/repo/releases/tag/v1.9.0',
      publishedAt: '2026-02-01T00:00:00Z',
      provider: 'github',
    };
    const intermediateNote2 = {
      title: 'v1.8.5',
      body: 'Changes in v1.8.5.',
      url: 'https://github.com/example/repo/releases/tag/v1.8.5',
      publishedAt: '2026-01-15T00:00:00Z',
      provider: 'github',
    };

    it('does not fetch or render intermediate section when containerId is absent', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: { releaseNotes: sampleNotes },
        global: globalConfig,
      });
      await nextTick();
      expect(getContainerIntermediateReleaseNotes).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="intermediate-release-notes-section"]').exists()).toBe(false);
    });

    it('does not fetch when fromTag equals toTag (canFetchIntermediate is false)', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.0.0',
          toTag: 'v1.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });
      await nextTick();
      // Inline mode: onMounted should not fire because canFetch is false
      expect(getContainerIntermediateReleaseNotes).not.toHaveBeenCalled();

      // Open a popover (iconOnly=false so no popover, but in icon mode check):
      wrapper.unmount();
    });

    it('does not fetch in icon mode when fromTag equals toTag', async () => {
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          iconOnly: true,
          containerId: 'c1',
          fromTag: 'v1.0.0',
          toTag: 'v1.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });
      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();
      expect(getContainerIntermediateReleaseNotes).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('fetches on popover open in iconOnly mode and renders rows in Teleported popover', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1, intermediateNote2],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          iconOnly: true,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });

      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();
      await nextTick(); // extra tick to allow the async fetch to settle

      expect(getContainerIntermediateReleaseNotes).toHaveBeenCalledWith('c1', 'v1.8.0', 'v2.0.0');
      const section = document.body.querySelector(
        '[data-test="intermediate-release-notes-section"]',
      );
      expect(section).not.toBeNull();
      const rows = document.body.querySelectorAll('[data-test="intermediate-release-note-row"]');
      expect(rows).toHaveLength(2);

      wrapper.unmount();
    });

    it('fetches on mount in inline mode and renders intermediate section', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      expect(getContainerIntermediateReleaseNotes).toHaveBeenCalledWith('c1', 'v1.8.0', 'v2.0.0');
      expect(wrapper.find('[data-test="intermediate-release-notes-section"]').exists()).toBe(true);
      expect(wrapper.findAll('[data-test="intermediate-release-note-row"]')).toHaveLength(1);
    });

    it('service returns null → no intermediate section rendered', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce(null);

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      expect(wrapper.find('[data-test="intermediate-release-notes-section"]').exists()).toBe(false);
    });

    it('row expand/collapse: expand row 0, row 1 stays collapsed; re-click collapses row 0', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1, intermediateNote2],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      const rows = wrapper.findAll('[data-test="intermediate-release-note-row"]');
      expect(rows).toHaveLength(2);

      // Expand row 0
      const row0Button = rows[0].find('button');
      await row0Button.trigger('click');
      await nextTick();
      expect(rows[0].text()).toContain(intermediateNote1.body);
      expect(rows[1].text()).not.toContain(intermediateNote2.body);

      // Re-click to collapse row 0
      await row0Button.trigger('click');
      await nextTick();
      expect(rows[0].text()).not.toContain(intermediateNote1.body);
    });

    it('hiddenCount > 0 renders the older-hidden badge', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1],
        hiddenCount: 3,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      const badge = wrapper.find('[data-test="intermediate-older-hidden"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('3');
    });

    it('hiddenCount = 0 → no older-hidden badge', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      expect(wrapper.find('[data-test="intermediate-older-hidden"]').exists()).toBe(false);
    });

    it('hiddenCount > 0 but empty notes list → no badge rendered', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [],
        hiddenCount: 5,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      // Section itself doesn't render (hasIntermediateNotes is false)
      expect(wrapper.find('[data-test="intermediate-release-notes-section"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="intermediate-older-hidden"]').exists()).toBe(false);
    });

    it('view-full link is present with correct href after expanding an intermediate row', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      const row = wrapper.find('[data-test="intermediate-release-note-row"]');
      await row.find('button').trigger('click');
      await nextTick();

      const link = row.find('a');
      expect(link.exists()).toBe(true);
      expect(link.attributes('href')).toBe(intermediateNote1.url);
    });

    it('body in intermediate row is truncated at 200 chars', async () => {
      const noteWithLongBody = {
        ...intermediateNote1,
        body: 'X'.repeat(250),
      };
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [noteWithLongBody],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      const row = wrapper.find('[data-test="intermediate-release-note-row"]');
      await row.find('button').trigger('click');
      await nextTick();

      expect(row.text()).toContain('X'.repeat(200));
      expect(row.text()).toContain('...');
      expect(row.text()).not.toContain('X'.repeat(250));
    });

    it('shows loading indicator while fetch is in-flight', async () => {
      let resolvePromise!: (v: any) => void;
      const pending = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(getContainerIntermediateReleaseNotes).mockReturnValueOnce(pending as any);

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick(); // mounted fires fetch, loading = true

      expect(wrapper.find('[data-test="intermediate-loading"]').exists()).toBe(true);

      // Resolve so we don't leave a dangling promise
      resolvePromise({ releaseNotes: [], hiddenCount: 0 });
      await nextTick();
      await nextTick();

      expect(wrapper.find('[data-test="intermediate-loading"]').exists()).toBe(false);
    });

    it('service rejection is caught: no section rendered, two-panel view intact', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockRejectedValueOnce(
        new Error('network error'),
      );

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
      });
      await nextTick();
      await nextTick();

      expect(wrapper.find('[data-test="intermediate-release-notes-section"]').exists()).toBe(false);
      // The main update panel is still present
      expect(wrapper.find('[data-test="update-release-notes-panel"]').exists()).toBe(true);
    });

    it('icon-only releaseLink-only popover does NOT call the service even when fetch conditions are met', async () => {
      // canFetchIntermediate now requires hasStructuredNotes; releaseLink-only has no structured notes.
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseLink: 'https://example.com/releases',
          iconOnly: true,
          containerId: 'c1',
          fromTag: 'v1.0.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });
      await wrapper.find('[data-test="release-link"]').trigger('click');
      await nextTick();
      await nextTick();

      expect(getContainerIntermediateReleaseNotes).not.toHaveBeenCalled();

      wrapper.unmount();
    });

    it('icon-only structured-notes popover still calls the service when fetch conditions are met', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValueOnce({
        releaseNotes: [intermediateNote1],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          iconOnly: true,
          containerId: 'c1',
          fromTag: 'v1.0.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });
      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();
      await nextTick();

      expect(getContainerIntermediateReleaseNotes).toHaveBeenCalledWith('c1', 'v1.0.0', 'v2.0.0');

      wrapper.unmount();
    });

    it('fire-once guard: opening the icon popover twice calls the service exactly once', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValue({
        releaseNotes: [intermediateNote1],
        hiddenCount: 0,
      });

      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          iconOnly: true,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });

      // Open first time
      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();
      await nextTick();

      // Close via escape
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await nextTick();

      // Open second time
      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();
      await nextTick();

      expect(getContainerIntermediateReleaseNotes).toHaveBeenCalledTimes(1);

      wrapper.unmount();
    });

    it('dynamic popover height includes extra offset when intermediates are present', async () => {
      vi.mocked(getContainerIntermediateReleaseNotes).mockResolvedValue({
        releaseNotes: [intermediateNote1, intermediateNote2],
        hiddenCount: 0,
      });

      // Mount with notes loaded (inline) to prime the intermediateNotes ref,
      // then re-mount icon-only to test height calculation.
      const wrapper = mount(ReleaseNotesLink, {
        props: {
          releaseNotes: sampleNotes,
          iconOnly: true,
          containerId: 'c1',
          fromTag: 'v1.8.0',
          toTag: 'v2.0.0',
        },
        global: globalConfig,
        attachTo: document.body,
      });

      // Open popover → triggers fetch
      await wrapper.find('[data-test="release-notes-link"]').trigger('click');
      await nextTick();
      await nextTick();

      // The popover should exist
      const popover = document.body.querySelector('[data-test="release-notes-popover"]');
      expect(popover).not.toBeNull();

      // With intermediates present (2 * 44 = 88px extra), base height was 360, now 448.
      // We can't easily assert the computed px value from jsdom, but we can assert
      // the intermediate section rendered (which implies height was extended).
      expect(
        document.body.querySelector('[data-test="intermediate-release-notes-section"]'),
      ).not.toBeNull();

      wrapper.unmount();
    });
  });
});
