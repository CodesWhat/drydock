import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
const updateContainer = vi.fn();
const confirmDelete = vi.fn();
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
    updateContainer,
    confirmDelete,
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
    updateContainer.mockReset();
    confirmDelete.mockReset();
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
    expect(panelBefore.attributes('style')).toContain('flex: 0 0 420px');
    expect(panelBefore.attributes('style')).toContain('width: 420px');

    const mediumButton = wrapper.findAll('button').find((button) => button.text().trim() === 'M');
    expect(mediumButton).toBeDefined();
    await mediumButton?.trigger('click');
    await nextTick();

    expect(panelSize.value).toBe('md');
    const panelAfter = wrapper.find('aside');
    expect(panelAfter.attributes('style')).toContain('flex: 0 0 560px');
    expect(panelAfter.attributes('style')).toContain('width: 560px');
  });
});
