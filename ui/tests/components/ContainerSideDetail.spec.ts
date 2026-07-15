import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import AppIconButton from '@/components/AppIconButton.vue';
import ContainerSideDetail from '@/components/containers/ContainerSideDetail.vue';
import DetailPanel from '@/components/DetailPanel.vue';

const selectedContainer = ref<any>({
  id: 'container-1',
  name: 'nginx',
  image: 'nginx',
  currentTag: 'latest',
  status: 'running',
  server: 'local',
  newTag: undefined,
});
const detailPanelOpen = ref(true);
const isMobile = ref(false);
const panelSize = ref<'sm' | 'md' | 'lg'>('sm');
const activeDetailTab = ref('overview');
const updateMode = ref<'notify' | 'manual' | 'auto'>('manual');

const closePanel = vi.fn();
const openFullPage = vi.fn();
const confirmStop = vi.fn();
const startContainer = vi.fn();
const confirmRestart = vi.fn();
const scanContainer = vi.fn();
const recheckContainer = vi.fn();
const recheckingContainerId = ref<string | null>(null);
const confirmUpdate = vi.fn();
const confirmDelete = vi.fn();
const isContainerUpdateInProgress = vi.fn(() => false);
const isContainerUpdateQueued = vi.fn(() => false);
const getContainerUpdateSequenceLabel = vi.fn(() => null);
const tt = (value: string) => value;

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    detailPanelOpen,
    isMobile,
    panelSize,
    closePanel,
    openFullPage,
    detailTabs: [{ id: 'overview', label: 'Overview', icon: 'info' }],
    activeDetailTab,
    updateMode,
    confirmStop,
    startContainer,
    confirmRestart,
    recheckContainer,
    recheckingContainerId,
    scanContainer,
    confirmUpdate,
    confirmDelete,
    isContainerUpdateInProgress,
    isContainerUpdateQueued,
    getContainerUpdateSequenceLabel,
    actionInProgress: ref(new Map<string, 'update' | 'scan' | 'lifecycle' | 'delete'>()),
    tt,
  }),
}));

describe('ContainerSideDetail', () => {
  afterEach(() => {
    detailPanelOpen.value = true;
    isMobile.value = false;
    panelSize.value = 'sm';
    activeDetailTab.value = 'overview';
    updateMode.value = 'manual';
    selectedContainer.value = {
      id: 'container-1',
      name: 'nginx',
      image: 'nginx',
      currentTag: 'latest',
      status: 'running',
      server: 'local',
      newTag: undefined,
    };
    closePanel.mockReset();
    openFullPage.mockReset();
    confirmStop.mockReset();
    startContainer.mockReset();
    confirmRestart.mockReset();
    scanContainer.mockReset();
    recheckContainer.mockReset();
    recheckingContainerId.value = null;
    confirmUpdate.mockReset();
    confirmDelete.mockReset();
    isContainerUpdateInProgress.mockReset();
    isContainerUpdateInProgress.mockReturnValue(false);
    isContainerUpdateQueued.mockReset();
    isContainerUpdateQueued.mockReturnValue(false);
    getContainerUpdateSequenceLabel.mockReset();
    getContainerUpdateSequenceLabel.mockReturnValue(null);
  });

  it('uses wrapping 44px controls for mobile container actions', () => {
    isMobile.value = true;
    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.get('[data-test="container-side-detail-actions"]').classes()).toContain(
      'flex-wrap',
    );
    const actionLabels = new Set(['Stop', 'Restart', 'Scan', 'Recheck for updates', 'Delete']);
    const actionButtons = wrapper
      .findAllComponents(AppIconButton)
      .filter((button) => actionLabels.has(button.attributes('aria-label') ?? ''));

    expect(actionButtons).toHaveLength(actionLabels.size);
    expect(actionButtons.map((button) => button.props('size'))).toEqual(
      Array(actionLabels.size).fill('sm'),
    );
  });

  it('updates panel width when size controls are clicked', async () => {
    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: {
          DetailPanel,
        },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: {
          tooltip: {},
        },
      },
    });

    const panelBefore = wrapper.find('aside');
    expect(panelBefore.exists()).toBe(true);
    expect(panelBefore.attributes('style')).toContain('flex: 0 0 var(--dd-layout-panel-width-sm)');
    expect(panelBefore.attributes('style')).toContain('width: var(--dd-layout-panel-width-sm)');

    const mediumButton = wrapper.findAll('button').find((button) => button.text().trim() === 'M');
    expect(mediumButton).toBeDefined();
    await mediumButton?.trigger('click');
    await nextTick();

    expect(panelSize.value).toBe('md');
    const panelAfter = wrapper.find('aside');
    expect(panelAfter.attributes('style')).toContain('flex: 0 0 var(--dd-layout-panel-width-md)');
    expect(panelAfter.attributes('style')).toContain('width: var(--dd-layout-panel-width-md)');
  });

  it('renders the selected container name with direct heading utility classes', () => {
    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: {
          DetailPanel,
        },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: {
          tooltip: {},
        },
      },
    });

    const title = wrapper
      .findAll('span')
      .find((candidate) => candidate.text().trim() === selectedContainer.value.name);
    expect(title).toBeDefined();
    expect(title?.classes()).toContain('text-sm');
    expect(title?.classes()).toContain('font-bold');
  });

  it('hides header update and force-update controls in notify mode', () => {
    updateMode.value = 'notify';
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      newTag: '1.2.3',
      bouncer: 'blocked',
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.find('button[aria-label="Update"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Blocked — Force Update"]').exists()).toBe(false);
  });

  it('shows the header update control for a suppressed raw candidate', () => {
    selectedContainer.value = {
      ...selectedContainer.value,
      newTag: null,
      newDigest: null,
      updateEligibility: {
        eligible: false,
        evaluatedAt: '2026-07-12T00:00:00.000Z',
        blockers: [{ reason: 'snoozed', severity: 'soft', message: 'Snoozed.', actionable: true }],
      },
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.find('button[aria-label="Update"]').exists()).toBe(true);
  });

  it('caps the subtitle and server badge so long values do not widen the panel', () => {
    selectedContainer.value = {
      id: 'container-1',
      name: 'nginx',
      image: 'very-long-image-name-that-should-truncate',
      currentTag: 'release-candidate-with-a-long-tag',
      status: 'running',
      server: 'very-long-server-name-that-should-truncate',
      newTag: undefined,
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: {
          DetailPanel,
        },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: {
          tooltip: {},
        },
      },
    });

    const subtitle = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().includes('very-long-image-name-that-should-truncate') &&
          candidate.classes().includes('max-w-[220px]'),
      );
    expect(subtitle).toBeDefined();
    expect(subtitle?.classes()).toContain('truncate');

    const serverBadgeText = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().includes('very-long-server-name-that-should-truncate') &&
          candidate.classes().includes('max-w-[160px]'),
      );
    expect(serverBadgeText).toBeDefined();
    expect(serverBadgeText?.classes()).toContain('truncate');
  });

  it('shows Updating when the selected container is still mid-update', () => {
    isContainerUpdateInProgress.mockReturnValue(true);

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: {
          DetailPanel,
        },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: {
          tooltip: {},
        },
      },
    });

    expect(wrapper.text()).toContain('Updating');
  });

  it('shows "Pulling…" when the container is mid-update at the pulling phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'pulling' },
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.text()).toContain('Pulling…');
  });

  it('shows "Health-checking…" when the container is at the health-gate phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'health-gate' },
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.text()).toContain('Health-checking…');
  });

  it('shows "Finalizing…" when the container is at the health-gate-passed phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'health-gate-passed' },
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.text()).toContain('Finalizing…');
  });

  it('shows "Rolling back…" when the container is at the rollback-started phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'rollback-started' },
    };

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: { tooltip: {} },
      },
    });

    expect(wrapper.text()).toContain('Rolling back…');
  });

  it('shows Queued when the selected container is still queued for update', () => {
    isContainerUpdateQueued.mockReturnValue(true);

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: {
          DetailPanel,
        },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: {
          tooltip: {},
        },
      },
    });

    expect(wrapper.text()).toContain('Queued');
  });

  it('renders the recheck icon button and calls recheckContainer on click', async () => {
    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: { tooltip: {} },
      },
    });

    // The recheck AppIconButton renders as a button element
    // Find buttons that have the recheck tooltip bound
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    // Click all buttons to verify recheckContainer is eventually called
    // (The recheck button is the one with the restart icon after scan)
    let recheckCalled = false;
    for (const btn of buttons) {
      await btn.trigger('click');
      if (recheckContainer.mock.calls.length > 0) {
        recheckCalled = true;
        break;
      }
    }
    expect(recheckCalled).toBe(true);
    expect(recheckContainer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'container-1', name: 'nginx' }),
    );
  });

  it('disables recheck button while recheck is in progress', () => {
    recheckingContainerId.value = 'container-1';

    const wrapper = mount(ContainerSideDetail, {
      global: {
        components: { DetailPanel },
        stubs: {
          AppIcon: { template: '<span class="app-icon-stub" />' },
          ContainerSideTabContent: { template: '<div class="side-tab-content-stub" />' },
        },
        directives: { tooltip: {} },
      },
    });

    const buttons = wrapper.findAll('button');
    const recheckBtn = buttons.find(
      (btn) => btn.attributes('aria-label') === 'Recheck for updates',
    );
    expect(recheckBtn).toBeDefined();
    expect(recheckBtn!.attributes('disabled')).toBeDefined();
  });
});
