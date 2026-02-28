import { flushPromises } from '@vue/test-utils';
import AuthView from '@/views/AuthView.vue';
import { getAllAuthentications, getAuthentication } from '@/services/authentication';
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

vi.mock('@/services/authentication', () => ({
  getAllAuthentications: vi.fn(),
  getAuthentication: vi.fn(),
}));

const mockGetAllAuthentications = getAllAuthentications as ReturnType<typeof vi.fn>;
const mockGetAuthentication = getAuthentication as ReturnType<typeof vi.fn>;

function makeAuthentication(overrides: Record<string, any> = {}) {
  return {
    id: 'auth-basic',
    name: 'Local Basic',
    type: 'basic',
    configuration: {
      users: 'local',
    },
    ...overrides,
  };
}

async function mountAuthView() {
  const wrapper = mountWithPlugins(AuthView, {
    global: { stubs: dataViewStubs },
  });
  await flushPromises();
  return wrapper;
}

describe('AuthView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.query = {};
    mockGetAllAuthentications.mockResolvedValue([makeAuthentication()]);
    mockGetAuthentication.mockResolvedValue(makeAuthentication());
  });

  it('loads providers, maps fields, and renders table rows', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      makeAuthentication({
        id: 'auth-local',
        name: 'Local Basic',
        type: 'basic',
        configuration: undefined,
      }),
      makeAuthentication({
        id: 'auth-github',
        name: 'GitHub OIDC',
        type: 'oidc',
        configuration: {
          issuer: 'https://token.actions.githubusercontent.com',
        },
      }),
    ]);
    mockGetAuthentication.mockResolvedValueOnce(
      makeAuthentication({
        id: 'auth-local',
        name: 'Local Basic',
        type: 'basic',
        configuration: undefined,
      }),
    );

    const wrapper = await mountAuthView();

    expect(mockGetAllAuthentications).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('2');

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Local Basic');
    expect(wrapper.text()).toContain('Basic');
    expect(wrapper.text()).toContain('active');
    expect(wrapper.text()).toContain('No configuration properties');
  });

  it('applies initial filter from route query q', async () => {
    mockRoute.query = { q: 'github' };
    mockGetAllAuthentications.mockResolvedValue([
      makeAuthentication({
        id: 'auth-local',
        name: 'Local Basic',
      }),
      makeAuthentication({
        id: 'auth-github',
        name: 'GitHub OIDC',
        type: 'oidc',
      }),
    ]);

    const wrapper = await mountAuthView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('github');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
  });

  it('shows inline error message when API request fails', async () => {
    mockGetAllAuthentications.mockRejectedValue(new Error('boom'));

    const wrapper = await mountAuthView();

    expect(wrapper.text()).toContain('Failed to load authentication providers');
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('0');
  });

  it('clicking a row fetches authentication details from per-component endpoint', async () => {
    mockGetAllAuthentications.mockResolvedValue([
      makeAuthentication({
        id: 'auth-basic',
        name: 'local',
        type: 'basic',
        configuration: undefined,
      }),
    ]);
    mockGetAuthentication.mockResolvedValue(
      makeAuthentication({
        id: 'auth-basic',
        name: 'local',
        type: 'basic',
        configuration: { issuer: 'https://issuer.example' },
      }),
    );

    const wrapper = await mountAuthView();
    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    expect(mockGetAuthentication).toHaveBeenCalledWith({
      type: 'basic',
      name: 'local',
      agent: undefined,
    });
    expect(wrapper.text()).toContain('issuer');
    expect(wrapper.text()).toContain('https://issuer.example');
  });
});
