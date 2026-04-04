import { flushPromises, mount } from '@vue/test-utils';
import ContainerLogsView from '@/views/ContainerLogsView.vue';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getAllContainers: vi.fn().mockResolvedValue([]),
  mapApiContainer: vi.fn((c: Record<string, unknown>) => ({
    id: c.id,
    name: c.name ?? c.id,
    image: 'nginx:latest',
    status: 'running',
    icon: '',
    currentTag: 'latest',
    newTag: null,
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'local',
    details: { ports: [], volumes: [], env: [], labels: [] },
  })),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: { id: 'container-1' },
  }),
  useRouter: () => ({
    push: mocks.push,
  }),
}));

vi.mock('@/services/container', () => ({
  getAllContainers: mocks.getAllContainers,
}));

vi.mock('@/utils/container-mapper', () => ({
  mapApiContainer: mocks.mapApiContainer,
}));

vi.mock('@/services/logs', () => ({
  createContainerLogStreamConnection: vi.fn(() => ({
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    close: vi.fn(),
    isPaused: vi.fn(() => false),
  })),
  downloadContainerLogs: vi.fn(async () => new Blob([])),
  toLogTailValue: (v: number | 'all') => (v === 'all' ? 2147483647 : v),
}));

function mountView(stubs: Record<string, unknown> = {}) {
  return mount(ContainerLogsView, {
    global: {
      stubs: {
        ContainerLogs: { template: '<div data-test="container-logs-stub" />' },
        ...stubs,
      },
    },
  });
}

describe('ContainerLogsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllContainers.mockResolvedValue([]);
  });

  describe('layout', () => {
    it('applies standard view layout classes on root element', () => {
      const wrapper = mountView();
      const root = wrapper.find('div');
      expect(root.classes()).toContain('flex-1');
      expect(root.classes()).toContain('min-h-0');
      expect(root.classes()).toContain('min-w-0');
      expect(root.classes()).toContain('overflow-hidden');
      expect(root.classes()).toContain('flex-col');
    });
  });

  describe('header', () => {
    it('shows container name from route param when container not loaded', () => {
      const wrapper = mountView();
      expect(wrapper.text()).toContain('container-1');
    });

    it('shows container name after loading', async () => {
      mocks.getAllContainers.mockResolvedValue([{ id: 'container-1', name: 'my-web-app' }]);
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.text()).toContain('my-web-app');
    });

    it('shows running status badge when container is running', async () => {
      mocks.getAllContainers.mockResolvedValue([{ id: 'container-1', name: 'web' }]);
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.text()).toContain('running');
    });

    it('shows "Container Logs" label', () => {
      const wrapper = mountView();
      expect(wrapper.text()).toContain('Container Logs');
    });
  });

  describe('back navigation', () => {
    it('navigates to containers page when back button clicked', async () => {
      const wrapper = mountView();
      const backButton = wrapper.find('button');
      await backButton.trigger('click');
      expect(mocks.push).toHaveBeenCalledWith('/containers');
    });
  });

  describe('container loading', () => {
    it('shows loading state initially', () => {
      mocks.getAllContainers.mockReturnValue(new Promise(() => {}));
      const wrapper = mountView();
      expect(wrapper.text()).toContain('Loading container');
    });

    it('shows error when container is not found', async () => {
      mocks.getAllContainers.mockResolvedValue([]);
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.text()).toContain('not found');
    });

    it('shows error when API call fails', async () => {
      mocks.getAllContainers.mockRejectedValue(new Error('network'));
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.text()).toContain('Failed to load container info');
    });

    it('renders ContainerLogs component when container loads successfully', async () => {
      mocks.getAllContainers.mockResolvedValue([{ id: 'container-1', name: 'web' }]);
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.find('[data-test="container-logs-stub"]').exists()).toBe(true);
    });

    it('does not render ContainerLogs when container not found', async () => {
      mocks.getAllContainers.mockResolvedValue([]);
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.find('[data-test="container-logs-stub"]').exists()).toBe(false);
    });

    it('matches container by id', async () => {
      mocks.getAllContainers.mockResolvedValue([
        { id: 'container-1', name: 'web' },
        { id: 'container-2', name: 'api' },
      ]);
      const wrapper = mountView();
      await flushPromises();
      expect(mocks.mapApiContainer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'container-1' }),
      );
      expect(wrapper.find('[data-test="container-logs-stub"]').exists()).toBe(true);
    });
  });

  describe('container image display', () => {
    it('shows container image below the name', async () => {
      mocks.getAllContainers.mockResolvedValue([{ id: 'container-1', name: 'web' }]);
      const wrapper = mountView();
      await flushPromises();
      expect(wrapper.text()).toContain('nginx:latest');
    });
  });
});
