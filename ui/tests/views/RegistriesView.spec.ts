import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { preferences, resetPreferences } from '@/preferences/store';
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

const registryCardFilterBarStub = defineComponent({
  props: [
    'modelValue',
    'viewModes',
    'showFilters',
    'filteredCount',
    'totalCount',
    'activeFilterCount',
    'hideViewToggle',
  ],
  emits: ['update:modelValue', 'update:showFilters'],
  template: `
    <div
      class="data-filter-bar registry-card-filter"
      :data-mode="modelValue"
      :data-hide-view-toggle="String(hideViewToggle)">
      <button
        v-for="mode in (viewModes || [{ id: 'table' }, { id: 'cards' }])"
        :key="mode.id"
        :class="'mode-' + mode.id"
        :data-active="String(modelValue === mode.id)"
        @click="$emit('update:modelValue', mode.id)">
        {{ mode.id }}
      </button>
      <slot name="filters" />
    </div>
  `,
});

const registryCardDataTableStub = defineComponent({
  props: ['columns', 'rows', 'rowKey', 'activeRow', 'selectedKey', 'preferCards'],
  emits: ['row-click', 'update:cardReflowForced'],
  template: `
    <div
      class="data-table registry-card-table"
      :data-row-count="rows?.length ?? 0"
      :data-prefer-cards="String(preferCards)"
      :data-selected-key="selectedKey || activeRow || ''">
      <button class="force-card-reflow" @click="$emit('update:cardReflowForced', true)">
        Force cards
      </button>
      <button class="clear-card-reflow" @click="$emit('update:cardReflowForced', false)">
        Clear cards
      </button>
      <article
        v-for="row in rows || []"
        :key="row[rowKey || 'id']"
        class="registry-card"
        :data-card-id="row[rowKey || 'id']">
        <slot name="card" :row="row" />
      </article>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

async function mountRegistriesCardView() {
  const wrapper = mountWithPlugins(RegistriesView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataFilterBar: registryCardFilterBarStub,
        DataTable: registryCardDataTableStub,
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

  it('dotted type.name query matches the registry instance id from container-detail deep links (#556)', async () => {
    // Container-detail links to /registries?q=<type>.<name> (e.g. "gcr.public").
    // That dotted id matches neither the bare name ("public") nor the bare type
    // ("gcr") alone — only the combined `${type}.${name}` check does.
    mockRoute.query = { q: 'gcr.public' };
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({ id: 'registry-1', name: 'Docker Hub', type: 'hub' }),
      makeRegistry({ id: 'registry-2', name: 'public', type: 'gcr' }),
    ]);

    const wrapper = await mountRegistriesView();

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe(
      'gcr.public',
    );
    expect(wrapper.find('.data-table').attributes('data-row-count')).toBe('1');
    // The table cell renders the registry's type badge (unknown types fall back to
    // their upper-cased type string) — confirms the surviving row is the gcr/public
    // one, not the hub/Docker Hub one.
    expect(wrapper.text()).toContain('GCR');
    expect(wrapper.text()).not.toContain('Hub');
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

  it('renders registry cards and wires the card-mode reflow controls', async () => {
    preferences.views.registries.mode = 'cards';
    mockGetAllRegistries.mockResolvedValue([
      makeRegistry({
        id: 'registry-1',
        name: 'Docker Hub',
        type: 'hub',
        configuration: { url: 'https://registry-1.docker.io', token: 'secret' },
      }),
      makeRegistry({
        id: 'registry-2',
        name: 'GitHub Container Registry',
        type: 'ghcr',
        configuration: {},
      }),
    ]);

    const wrapper = await mountRegistriesCardView();

    expect(wrapper.get('.registry-card-table').attributes('data-prefer-cards')).toBe('true');
    expect(wrapper.get('.registry-card-filter').attributes('data-mode')).toBe('cards');
    expect(wrapper.get('.registry-card-filter').attributes('data-hide-view-toggle')).toBe('false');

    const hubCard = wrapper.get('[data-card-id="registry-1"]');
    expect(hubCard.text()).toContain('Docker Hub');
    expect(hubCard.text()).toContain('https://registry-1.docker.io');
    expect(hubCard.text()).toContain('Hub');
    expect(hubCard.text()).toContain('Auth');
    expect(hubCard.text()).toContain('Private');
    expect(hubCard.text()).toContain('Status');
    expect(hubCard.text()).toContain('Connected');

    const ghcrCard = wrapper.get('[data-card-id="registry-2"]');
    expect(ghcrCard.text()).toContain('GitHub Container Registry');
    expect(ghcrCard.text()).toContain('GHCR');
    expect(ghcrCard.text()).toContain('https://ghcr.io');
    expect(ghcrCard.text()).toContain('Public');

    await wrapper.get('.force-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.registry-card-filter').attributes('data-hide-view-toggle')).toBe('true');

    await wrapper.get('.clear-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.registry-card-filter').attributes('data-hide-view-toggle')).toBe('false');
  });
});
