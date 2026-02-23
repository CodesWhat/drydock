import { flushPromises } from '@vue/test-utils';
import RegistriesView from '@/views/RegistriesView.vue';
import { getAllRegistries } from '@/services/registry';
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
}));

const mockGetAllRegistries = getAllRegistries as ReturnType<typeof vi.fn>;

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
});
