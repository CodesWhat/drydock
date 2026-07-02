import type { VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, h, provide, ref } from 'vue';
import ContainersListContent from '@/components/containers/ContainersListContent.vue';
import {
  type ContainersViewTemplateContext,
  containersViewTemplateContextKey,
} from '@/components/containers/containersViewTemplateContext';
import { mountWithPlugins } from '../../helpers/mount';

const DataTableColumnPickerStub = defineComponent({
  props: ['columns', 'hiddenKeys'],
  emits: ['toggle', 'reset'],
  template: `
    <div data-test="data-table-column-picker">
      <button
        v-for="column in columns"
        :key="column.key"
        type="button"
        :data-test="'column-picker-toggle-' + column.key"
        @click="$emit('toggle', column.key)">
        {{ column.label }}
      </button>
      <button type="button" data-test="data-table-column-picker-reset" @click="$emit('reset')">
        Reset
      </button>
    </div>
  `,
});

function makeTemplateContext(
  overrides: Partial<ContainersViewTemplateContext> = {},
): ContainersViewTemplateContext {
  return {
    error: ref(null),
    loading: ref(false),
    showFilters: ref(false),
    filteredContainers: ref([]),
    containers: ref([]),
    activeFilterCount: computed(() => 0),
    filterSearch: ref(''),
    filterStatus: ref('all'),
    filterBouncer: ref('all'),
    filterRegistry: ref('all'),
    filterServer: ref('all'),
    serverNames: computed(() => []),
    filterKind: ref('all'),
    filterHidePinned: ref(false),
    clearFilters: vi.fn(),
    allColumns: [
      {
        key: 'name',
        label: 'Container',
        labelKey: 'containersView.columns.container',
        required: true,
      },
      {
        key: 'status',
        label: 'Status',
        labelKey: 'containersView.columns.status',
        required: false,
      },
      { key: 'icon', label: '', required: true },
    ] as any,
    toggleColumn: vi.fn(),
    visibleColumns: ref(new Set(['name', 'status', 'icon'])),
    hiddenColumnKeys: computed(() => []),
    resetColumns: vi.fn(),
    tt: (label: string) => ({ value: label, showDelay: 0 }),
    groupByStack: ref(false) as any,
    rechecking: ref(false),
    recheckAll: vi.fn(),
    expandAllGroups: vi.fn(),
    collapseAllGroups: vi.fn(),
    allGroupsCollapsed: computed(() => false),
    filterContainerIds: ref(new Set()),
    clearContainerIdsFilter: vi.fn(),
    ...overrides,
  } as unknown as ContainersViewTemplateContext;
}

describe('ContainersListContent', () => {
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  function mountWithContext(context: ContainersViewTemplateContext) {
    const Parent = defineComponent({
      setup() {
        provide(containersViewTemplateContextKey, context);
        return () => h(ContainersListContent);
      },
    });

    return mountWithPlugins(Parent, {
      global: {
        stubs: {
          AppIconButton: {
            props: ['icon', 'tooltip'],
            emits: ['click'],
            template:
              '<button type="button" class="app-icon-button-stub" :data-icon="icon" @click="$emit(\'click\', $event)">{{ tooltip?.value }}</button>',
          },
          ContainersGroupedViews: {
            template: '<div data-test="grouped-views-stub" />',
          },
          DataFilterBar: {
            template:
              '<div data-test="data-filter-bar"><slot name="extra-buttons" /><slot name="left" /><slot name="center" /><slot name="filters" /></div>',
          },
          DataTableColumnPicker: DataTableColumnPickerStub,
        },
      },
    });
  }

  it('renders the shared column picker in the extra-buttons slot', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    expect(wrapper.find('[data-test="data-table-column-picker"]').exists()).toBe(true);
  });

  it('passes only labelled catalog columns (translated) to the picker', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    // icon has no labelKey, so it is excluded from the picker's toggleable columns.
    expect(wrapper.find('[data-test="column-picker-toggle-icon"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="column-picker-toggle-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="column-picker-toggle-status"]').exists()).toBe(true);
  });

  it('passes the picker-hidden set only — a column hidden by preference is reflected as hidden', () => {
    const context = makeTemplateContext({
      visibleColumns: ref(new Set(['name', 'icon'])),
    });
    wrapper = mountWithContext(context);

    const picker = wrapper.findComponent(DataTableColumnPickerStub);
    expect(picker.props('hiddenKeys')).toEqual(['status']);
  });

  it('emits toggleColumn via the picker toggle event', async () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    await wrapper.find('[data-test="column-picker-toggle-status"]').trigger('click');

    expect(context.toggleColumn).toHaveBeenCalledWith('status');
  });

  it('calls resetColumns via the picker reset event', async () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    await wrapper.find('[data-test="data-table-column-picker-reset"]').trigger('click');

    expect(context.resetColumns).toHaveBeenCalledOnce();
  });
});
