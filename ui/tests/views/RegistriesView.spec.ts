import { flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { resetPreferences } from '@/preferences/store';
import { getAllRegistries, getRegistry } from '@/services/registry';
import RegistriesView from '@/views/RegistriesView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

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
    global: {
      stubs: {
        ...dataViewStubs,
        DataTable: defineComponent({
          props: ['columns', 'rows', 'rowKey', 'activeRow'],
          emits: ['row-click'],
          template: `
            <div class="data-table" :data-row-count="rows?.length ?? 0" :data-active-row="activeRow || ''">
              <div v-for="row in rows" :key="row[rowKey || 'id']" class="data-table-row">
                <button v-if="row" class="row-click-first" @click="$emit('row-click', row)">Open</button>
                <slot name="cell-name" :row="row" />
                <slot name="cell-type" :row="row" />
                <slot name="cell-status" :row="row" />
                <slot name="cell-url" :row="row" />
                <slot name="empty" v-if="!rows || rows.length === 0" />
              </div>
            </div>
          `,
        }),
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('RegistriesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
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

  it('opens registry details from list mode selections', async () => {
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({
        id: 'registry-1',
        name: 'AWS ECR',
        type: 'ecr',
        configuration: { url: 'https://list.example' },
      }),
    ]);
    mockGetRegistry.mockResolvedValue(
      makeRegistry({
        id: 'registry-1',
        name: 'AWS ECR',
        type: 'ecr',
        configuration: {
          url: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com',
          region: 'us-east-1',
        },
      }),
    );

    const wrapper = await mountRegistriesView();

    await wrapper.find('.mode-list').trigger('click');
    await flushPromises();
    await wrapper.find('.list-click-first').trigger('click');
    await flushPromises();

    expect(wrapper.find('.detail-panel').attributes('data-open')).toBe('true');
    expect(mockGetRegistry).toHaveBeenCalledWith({
      type: 'ecr',
      name: 'AWS ECR',
      agent: undefined,
    });
    expect(wrapper.text()).toContain('us-east-1');
    expect(wrapper.text()).toContain('123456789012.dkr.ecr.us-east-1.amazonaws.com');
  });

  it('caps long registry URLs in compact table and detail surfaces', async () => {
    const longUrl =
      'https://registry.example.internal/company/team/service/component/releases/2026/04/with-an-extra-long-path';
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({
        name: 'Long Registry',
        configuration: { url: longUrl },
      }),
    ]);
    mockGetRegistry.mockResolvedValue(
      makeRegistry({
        name: 'Long Registry',
        configuration: { url: longUrl },
      }),
    );

    const wrapper = await mountRegistriesView();

    const tableUrl = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().trim() === longUrl && candidate.classes().includes('max-w-[220px]'),
      );
    expect(tableUrl).toBeDefined();
    expect(tableUrl?.classes()).toContain('truncate');

    await wrapper.find('.row-click-first').trigger('click');
    await flushPromises();

    const detailUrl = wrapper
      .findAll('span')
      .find(
        (candidate) =>
          candidate.text().trim() === longUrl && candidate.classes().includes('max-w-[220px]'),
      );
    expect(detailUrl).toBeDefined();
    expect(detailUrl?.classes()).toContain('truncate');
  });
});
