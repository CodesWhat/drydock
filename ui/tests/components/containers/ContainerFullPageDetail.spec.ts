import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ContainerFullPageDetail from '@/components/containers/ContainerFullPageDetail.vue';

const selectedContainer = ref({
  id: 'container-1',
  name: 'nginx',
  image: 'nginx',
  currentTag: 'latest',
  status: 'running',
  registry: 'hub',
  registryUrl: '',
  registryName: '',
  newTag: undefined as string | undefined,
  updateKind: undefined as string | undefined,
});

const activeDetailTab = ref('overview');
const actionInProgress = ref(new Map<string, 'update' | 'scan' | 'lifecycle' | 'delete'>());
const closeFullPage = vi.fn();
const confirmStop = vi.fn();
const startContainer = vi.fn();
const confirmRestart = vi.fn();
const scanContainer = vi.fn();
const confirmUpdate = vi.fn();
const confirmDelete = vi.fn();
const isContainerUpdateInProgress = vi.fn(() => false);
const isContainerUpdateQueued = vi.fn(() => false);
const getContainerUpdateSequenceLabel = vi.fn(() => null);

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    closeFullPage,
    confirmStop,
    startContainer,
    confirmRestart,
    scanContainer,
    confirmUpdate,
    confirmDelete,
    isContainerUpdateInProgress,
    isContainerUpdateQueued,
    getContainerUpdateSequenceLabel,
    actionInProgress,
    registryColorBg: () => '#eee',
    registryColorText: () => '#333',
    registryLabel: () => 'hub',
    updateKindColor: () => ({ bg: '#eee', text: '#333' }),
    detailTabs: [{ id: 'overview', label: 'Overview', icon: 'info' }],
    activeDetailTab,
  }),
}));

function factory() {
  return mount(ContainerFullPageDetail, {
    global: {
      stubs: {
        AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] },
        ContainerFullPageTabContent: { template: '<div class="tab-content-stub" />' },
      },
    },
  });
}

describe('ContainerFullPageDetail', () => {
  afterEach(() => {
    activeDetailTab.value = 'overview';
    actionInProgress.value = new Map();
    isContainerUpdateInProgress.mockReset();
    isContainerUpdateInProgress.mockReturnValue(false);
    isContainerUpdateQueued.mockReset();
    isContainerUpdateQueued.mockReturnValue(false);
    getContainerUpdateSequenceLabel.mockReset();
    getContainerUpdateSequenceLabel.mockReturnValue(null);
    selectedContainer.value = {
      id: 'container-1',
      name: 'nginx',
      image: 'nginx',
      currentTag: 'latest',
      status: 'running',
      registry: 'hub',
      registryUrl: '',
      registryName: '',
      newTag: undefined,
      updateKind: undefined,
    };
  });

  describe('layout spacing', () => {
    it('applies pr-[15px] for scrollbar centering', () => {
      const wrapper = factory();
      const root = wrapper.find('[data-test="container-full-page-detail"]');
      expect(root.classes()).toContain('sm:pr-[15px]');
    });

    it('does not use legacy scrollbar compensation padding', () => {
      const wrapper = factory();
      const root = wrapper.find('[data-test="container-full-page-detail"]');
      expect(root.classes()).not.toContain('sm:pr-2');
      expect(root.classes()).not.toContain('sm:pr-4');
      expect(root.classes()).not.toContain('sm:pr-5');
    });
  });

  it('renders container name', () => {
    const wrapper = factory();
    expect(wrapper.text()).toContain('nginx');
  });

  it('shows Updating when the selected container is still mid-update', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    const wrapper = factory();
    expect(wrapper.text()).toContain('Updating');
  });

  it('shows "Pulling…" when the container is mid-update at the pulling phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'pulling' },
    };
    const wrapper = factory();
    expect(wrapper.text()).toContain('Pulling…');
  });

  it('shows "Health-checking…" when the container is at the health-gate phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'health-gate' },
    };
    const wrapper = factory();
    expect(wrapper.text()).toContain('Health-checking…');
  });

  it('shows "Finalizing…" when the container is at the health-gate-passed phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'health-gate-passed' },
    };
    const wrapper = factory();
    expect(wrapper.text()).toContain('Finalizing…');
  });

  it('shows "Rolling back…" when the container is at the rollback-started phase', () => {
    isContainerUpdateInProgress.mockReturnValue(true);
    (selectedContainer as any).value = {
      ...selectedContainer.value,
      updateOperation: { phase: 'rollback-started' },
    };
    const wrapper = factory();
    expect(wrapper.text()).toContain('Rolling back…');
  });

  it('shows Queued when the selected container is still queued for update', () => {
    isContainerUpdateQueued.mockReturnValue(true);
    const wrapper = factory();
    expect(wrapper.text()).toContain('Queued');
  });

  it('renders Back button that calls closeFullPage', async () => {
    const wrapper = factory();
    const backBtn = wrapper.findAll('button').find((b) => b.text().includes('Back'));
    expect(backBtn).toBeDefined();
    await backBtn?.trigger('click');
    expect(closeFullPage).toHaveBeenCalled();
  });

  describe('aria-labels', () => {
    it('has aria-label on all action buttons', () => {
      const wrapper = factory();
      const labels = ['Stop container', 'Restart container', 'Scan container', 'Delete container'];
      for (const label of labels) {
        expect(wrapper.find(`button[aria-label="${label}"]`).exists()).toBe(true);
      }
    });

    it('has aria-label on Start button when container is stopped', () => {
      selectedContainer.value.status = 'stopped';
      const wrapper = factory();
      expect(wrapper.find('button[aria-label="Start container"]').exists()).toBe(true);
    });

    it('has aria-label on Update button when update is available', () => {
      selectedContainer.value.newTag = '2.0';
      selectedContainer.value.updateKind = 'major';
      const wrapper = factory();
      expect(wrapper.find('button[aria-label="Update container"]').exists()).toBe(true);
    });
  });

  describe('disabled state during action', () => {
    it('disables action buttons when actionInProgress matches container id', () => {
      actionInProgress.value = new Map([['container-1', 'update']]);
      const wrapper = factory();
      const actionButtons = wrapper
        .findAll('button')
        .filter((b) => b.attributes('aria-label')?.endsWith('container'));
      for (const btn of actionButtons) {
        expect(btn.attributes('disabled')).toBeDefined();
      }
    });

    it('does not disable buttons when actionInProgress is a different container', () => {
      actionInProgress.value = new Map([['other-container-id', 'update']]);
      const wrapper = factory();
      const actionButtons = wrapper
        .findAll('button')
        .filter((b) => b.attributes('aria-label')?.endsWith('container'));
      for (const btn of actionButtons) {
        expect(btn.attributes('disabled')).toBeUndefined();
      }
    });

    it('applies opacity-50 class when disabled', () => {
      actionInProgress.value = new Map([['container-1', 'update']]);
      const wrapper = factory();
      const stopBtn = wrapper.find('button[aria-label="Stop container"]');
      expect(stopBtn.classes()).toContain('opacity-50');
      expect(stopBtn.classes()).toContain('cursor-not-allowed');
    });

    it('does not apply opacity-50 class when not disabled', () => {
      actionInProgress.value = new Map();
      const wrapper = factory();
      const stopBtn = wrapper.find('button[aria-label="Stop container"]');
      expect(stopBtn.classes()).not.toContain('opacity-50');
    });
  });
});
