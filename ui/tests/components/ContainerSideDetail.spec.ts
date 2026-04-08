import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ContainerSideDetail from '@/components/containers/ContainerSideDetail.vue';
import DetailPanel from '@/components/DetailPanel.vue';

const selectedContainer = ref({
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

const closePanel = vi.fn();
const openFullPage = vi.fn();
const confirmStop = vi.fn();
const startContainer = vi.fn();
const confirmRestart = vi.fn();
const scanContainer = vi.fn();
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
    confirmStop,
    startContainer,
    confirmRestart,
    scanContainer,
    confirmUpdate,
    confirmDelete,
    isContainerUpdateInProgress,
    isContainerUpdateQueued,
    getContainerUpdateSequenceLabel,
    actionInProgress: ref(new Set<string>()),
    tt,
  }),
}));

describe('ContainerSideDetail', () => {
  afterEach(() => {
    detailPanelOpen.value = true;
    panelSize.value = 'sm';
    activeDetailTab.value = 'overview';
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
    confirmUpdate.mockReset();
    confirmDelete.mockReset();
    isContainerUpdateInProgress.mockReset();
    isContainerUpdateInProgress.mockReturnValue(false);
    isContainerUpdateQueued.mockReset();
    isContainerUpdateQueued.mockReturnValue(false);
    getContainerUpdateSequenceLabel.mockReset();
    getContainerUpdateSequenceLabel.mockReturnValue(null);
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
});
