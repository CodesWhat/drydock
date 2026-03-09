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
const closeFullPage = vi.fn();
const confirmStop = vi.fn();
const startContainer = vi.fn();
const confirmRestart = vi.fn();
const scanContainer = vi.fn();
const confirmUpdate = vi.fn();
const confirmDelete = vi.fn();

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

  it('renders Back button that calls closeFullPage', async () => {
    const wrapper = factory();
    const backBtn = wrapper.findAll('button').find((b) => b.text().includes('Back'));
    expect(backBtn).toBeDefined();
    await backBtn?.trigger('click');
    expect(closeFullPage).toHaveBeenCalled();
  });
});
