import type { Component } from 'vue';
import { defineComponent } from 'vue';
import { expectContainerQuickLinks, quickLinkTestIds } from '../../helpers/containerQuickLinks';
import { mountWithPlugins } from '../../helpers/mount';

const containerLinkActionsModulePath =
  '../../../src/components/containers/ContainerLinkActions.vue';
let ContainerLinkActions: Component;

beforeAll(async () => {
  ContainerLinkActions = (await import(containerLinkActionsModulePath)).default as Component;
});

function mountActions(props: Record<string, unknown>) {
  return mountWithPlugins(ContainerLinkActions, {
    props,
    global: { stubs: { Teleport: true } },
  });
}

describe('ContainerLinkActions', () => {
  it('keeps source, release notes, and registry in a stable order with 44px targets', () => {
    const wrapper = mountActions({
      sourceRepo: 'github.com/example/project',
      releaseLink: 'https://example.test/releases/2.0.0',
      registry: 'custom',
      registryName: 'registry.example.com',
      registryUrl: 'https://registry.example.com/v2',
    });

    expectContainerQuickLinks(
      wrapper.get('[data-test="container-quick-links"]'),
      'registry.example.com',
    );
  });

  it('omits unavailable actions independently', () => {
    const sourceOnly = mountActions({ sourceRepo: 'github.com/example/project' });
    const releaseOnly = mountActions({ releaseLink: 'https://example.test/releases/2.0.0' });
    const registryOnly = mountActions({ registry: 'ghcr' });

    expect(quickLinkTestIds(sourceOnly.get('[data-test="container-quick-links"]'))).toEqual([
      'project-link',
    ]);
    expect(quickLinkTestIds(releaseOnly.get('[data-test="container-quick-links"]'))).toEqual([
      'release-link',
    ]);
    expect(quickLinkTestIds(registryOnly.get('[data-test="container-quick-links"]'))).toEqual([
      'registry-link',
    ]);
  });

  it('forwards structured current and available notes to the release popover', async () => {
    const wrapper = mountActions({
      releaseNotes: {
        title: '2.0.0',
        body: 'Available release notes',
        url: 'https://example.test/releases/2.0.0',
      },
      currentReleaseNotes: {
        title: '1.0.0',
        body: 'Current release notes',
        url: 'https://example.test/releases/1.0.0',
      },
    });

    await wrapper.get('[data-test="release-notes-link"]').trigger('click');

    expect(wrapper.get('[data-test="release-notes-popover"]').attributes('role')).toBe('dialog');
    expect(wrapper.find('[data-test="current-release-notes-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="update-release-notes-panel"]').exists()).toBe(true);
  });

  it.each([
    'Enter',
    ' ',
  ])('stops %s keydown events from activating the clickable parent row', async (key) => {
    const parentKeydown = vi.fn();
    const Host = defineComponent({
      components: { ContainerLinkActions },
      setup() {
        return { parentKeydown };
      },
      template: `
          <div data-test="clickable-row" @keydown="parentKeydown">
            <ContainerLinkActions source-repo="github.com/example/project" />
          </div>
        `,
    });
    const wrapper = mountWithPlugins(Host);

    await wrapper.get('[data-test="project-link"]').trigger('keydown', { key });

    expect(parentKeydown).not.toHaveBeenCalled();
  });

  it('allows non-activation keys to reach containing keyboard handlers', async () => {
    const parentKeydown = vi.fn();
    const Host = defineComponent({
      components: { ContainerLinkActions },
      setup: () => ({ parentKeydown }),
      template: `
        <div @keydown="parentKeydown">
          <ContainerLinkActions source-repo="github.com/example/project" />
        </div>
      `,
    });
    const wrapper = mountWithPlugins(Host);

    await wrapper.get('[data-test="project-link"]').trigger('keydown', { key: 'Escape' });

    expect(parentKeydown).toHaveBeenCalledOnce();
  });
});
