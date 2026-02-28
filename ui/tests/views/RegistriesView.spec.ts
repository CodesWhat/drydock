import { flushPromises } from '@vue/test-utils';
import RegistriesView from '@/views/RegistriesView.vue';
import { getAllRegistries, getRegistry } from '@/services/registry';
import { mountWithPlugins } from '../helpers/mount';
import { dataViewStubs } from '../helpers/data-view-stubs';

const { mockRoute } = vi.hoisted(() => ({
  mockRoute: { query: {} as Record<string, unknown> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

vi.mock('@/composables/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isMobile: { value: false },
  }),
}));

vi.mock('@/services/registry', () => ({
  getAllRegistries: vi.fn(),
  getRegistry: vi.fn(),
}));

const mockGetAllRegistries = getAllRegistries as ReturnType<typeof vi.fn>;
const mockGetRegistry = getRegistry as ReturnType<typeof vi.fn>;

function makeRegistry(overrides: Record<string, any> = {}) {
  return {
    id: 'registry-1',
    name: 'Docker Hub',
    type: 'hub',
    configuration: { url: 'https://registry-1.docker.io' },
    ...overrides,
  };
}

async function mountRegistriesView() {
  const wrapper = mountWithPlugins(RegistriesView, {
    global: { stubs: dataViewStubs },
  });
  await flushPromises();
  return wrapper;
}

describe('RegistriesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockGetAllRegistries.mockResolvedValue([makeRegistry()]);
    mockGetRegistry.mockResolvedValue(makeRegistry());
  });

  it('successful load renders registry rows', async () => {
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({ id: 'registry-1', name: 'Docker Hub', type: 'hub' }),
      makeRegistry({ id: 'registry-2', name: 'GitHub Container Registry', type: 'ghcr' }),
    ]);

    const wrapper = await mountRegistriesView();

    expect(mockGetAllRegistries).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');
  });

  it('route query q filters rows', async () => {
    mockRoute.query = { q: 'ghcr' };
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({ id: 'registry-1', name: 'Docker Hub', type: 'hub' }),
      makeRegistry({ id: 'registry-2', name: 'GitHub Container Registry', type: 'ghcr' }),
    ]);

    const wrapper = await mountRegistriesView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('ghcr');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('API failure shows "Failed to load registries"', async () => {
    mockGetAllRegistries.mockRejectedValue(new Error('boom'));

    const wrapper = await mountRegistriesView();

    expect(wrapper.text()).toContain('Failed to load registries');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('0');
  });

  it('clicking a row fetches registry details from per-component endpoint', async () => {
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({
        id: 'registry-1',
        name: 'private',
        type: 'hub',
        configuration: { url: 'https://list.example' },
      }),
    ]);
    mockGetRegistry.mockResolvedValue(
      makeRegistry({
        id: 'registry-1',
        name: 'private',
        type: 'hub',
        configuration: { url: 'https://detail.example', namespace: 'team-a' },
      }),
    );

    const wrapper = await mountRegistriesView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(mockGetRegistry).toHaveBeenCalledWith({
      type: 'hub',
      name: 'private',
      agent: undefined,
    });
    expect(wrapper.text()).toContain('https://detail.example');
    expect(wrapper.text()).toContain('team-a');
  });
});
