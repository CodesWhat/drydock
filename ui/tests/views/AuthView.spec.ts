import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { preferences, resetPreferences } from '@/preferences/store';
import { getAllAuthentications, getAuthentication } from '@/services/authentication';
import AuthView from '@/views/AuthView.vue';
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

const authCardFilterBarStub = defineComponent({
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
      class="data-filter-bar auth-card-filter"
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

const authCardDataTableStub = defineComponent({
  props: [
    'columns',
    'rows',
    'rowKey',
    'activeRow',
    'selectedKey',
    'sortKey',
    'sortAsc',
    'preferCards',
  ],
  emits: ['row-click', 'update:cardReflowForced'],
  template: `
    <div
      class="data-table auth-card-table"
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
        class="auth-card"
        :data-card-id="row[rowKey || 'id']">
        <slot name="card" :row="row" />
      </article>
      <slot name="empty" v-if="!rows || rows.length === 0" />
    </div>
  `,
});

async function mountAuthCardView() {
  const wrapper = mountWithPlugins(AuthView, {
    global: {
      stubs: {
        ...dataViewStubs,
        DataFilterBar: authCardFilterBarStub,
        DataTable: authCardDataTableStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('AuthView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferences();
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

  it('renders auth provider cards and wires the card-mode reflow controls', async () => {
    preferences.views.auth.mode = 'cards';
    mockGetAllAuthentications.mockResolvedValue([
      makeAuthentication({
        id: 'auth-basic',
        name: 'Local Basic',
        type: 'basic',
        configuration: { users: 'local' },
      }),
      makeAuthentication({
        id: 'auth-github',
        name: 'GitHub OIDC',
        type: 'oidc',
        configuration: { issuer: 'https://token.actions.githubusercontent.com' },
      }),
    ]);

    const wrapper = await mountAuthCardView();

    expect(wrapper.get('.auth-card-table').attributes('data-prefer-cards')).toBe('true');
    expect(wrapper.get('.auth-card-filter').attributes('data-mode')).toBe('cards');
    expect(wrapper.get('.auth-card-filter').attributes('data-hide-view-toggle')).toBe('false');

    const basicCard = wrapper.get('[data-card-id="auth-basic"]');
    expect(basicCard.text()).toContain('Local Basic');
    expect(basicCard.text()).toContain('Basic');
    expect(basicCard.text()).toContain('users');
    expect(basicCard.text()).toContain('local');
    expect(basicCard.text()).toContain('active');

    const oidcCard = wrapper.get('[data-card-id="auth-github"]');
    expect(oidcCard.text()).toContain('GitHub OIDC');
    expect(oidcCard.text()).toContain('OIDC');
    expect(oidcCard.text()).toContain('issuer');
    expect(oidcCard.text()).toContain('https://token.actions.githubusercontent.com');

    await wrapper.get('.force-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.auth-card-filter').attributes('data-hide-view-toggle')).toBe('true');

    await wrapper.get('.clear-card-reflow').trigger('click');
    await nextTick();
    expect(wrapper.get('.auth-card-filter').attributes('data-hide-view-toggle')).toBe('false');
  });
});
