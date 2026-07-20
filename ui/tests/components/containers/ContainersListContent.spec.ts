import type { VueWrapper } from '@vue/test-utils';
import {
  computed,
  defineComponent,
  h,
  nextTick,
  provide,
  type Ref,
  ref,
  type WritableComputedRef,
} from 'vue';
import ContainersListContent from '@/components/containers/ContainersListContent.vue';
import {
  type ContainersViewTableColumn,
  type ContainersViewTemplateContext,
  containersViewTemplateContextKey,
} from '@/components/containers/containersViewTemplateContext';
import type { ViewMode } from '@/preferences/schema';
import { mountWithPlugins } from '../../helpers/mount';

const DataTableColumnPickerStub = defineComponent({
  props: ['columns', 'hiddenKeys', 'autoHiddenKeys'],
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

const DataFilterBarStub = defineComponent({
  props: [
    'modelValue',
    'showFilters',
    'filteredCount',
    'totalCount',
    'activeFilterCount',
    'hideViewToggle',
  ],
  emits: ['update:modelValue', 'update:showFilters'],
  template: `
    <div data-test="data-filter-bar" :data-model-value="modelValue">
      <button type="button" data-test="set-view-table" @click="$emit('update:modelValue', 'table')">
        Table
      </button>
      <button type="button" data-test="set-view-cards" @click="$emit('update:modelValue', 'cards')">
        Cards
      </button>
      <slot name="sort" />
      <slot name="extra-buttons" />
      <slot name="left" />
      <slot name="center" />
      <slot name="filters" />
    </div>
  `,
});

// containerViewMode/containerSortKey/containerSortAsc are writable computeds on the real
// context, and a plain ref is not assignable to WritableComputedRef.
function writableRef<T>(initial: T): WritableComputedRef<T> {
  const inner = ref(initial) as Ref<T>;
  return computed({
    get: () => inner.value,
    set: (value: T) => {
      inner.value = value;
    },
  });
}

function makeTemplateContext(
  overrides: Partial<ContainersViewTemplateContext> = {},
): ContainersViewTemplateContext {
  return {
    error: ref(null),
    loading: ref(false),
    containerViewMode: writableRef<ViewMode>('table'),
    containerCardReflowForced: ref(false),
    containerSortKey: writableRef('name'),
    containerSortAsc: writableRef(true),
    tableColumns: computed<ContainersViewTableColumn[]>(() => [
      { key: 'icon', label: '', sortable: false, icon: true },
      { key: 'name', label: 'Container', sortable: true, icon: false },
      { key: 'status', label: 'Status', sortable: true, icon: false },
    ]),
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
    autoHiddenColumns: computed(() => []),
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
            props: ['icon', 'tooltip', 'disabled', 'ariaLabel', 'size'],
            emits: ['click'],
            template:
              '<button v-bind="$attrs" type="button" class="app-icon-button-stub" :disabled="disabled" :data-icon="icon" :data-size="size" :aria-label="ariaLabel" @click="$emit(\'click\', $event)">{{ tooltip?.value ?? tooltip }}</button>',
          },
          ContainersGroupedViews: {
            template: '<div data-test="grouped-views-stub" />',
          },
          DataFilterBar: DataFilterBarStub,
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

  it('uses 44px icon-button sizes for group and recheck toolbar actions', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    expect(wrapper.get('[data-icon="stack"]').attributes('data-size')).toBe('sm');
    expect(wrapper.get('[data-icon="restart"]').attributes('data-size')).toBe('sm');
    expect(wrapper.get('[data-icon="stack"]').classes()).toContain('shrink-0');
    expect(wrapper.get('[data-icon="restart"]').classes()).toContain('shrink-0');
  });

  it('gives group and recheck toolbar actions stable accessible names', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    expect(wrapper.get('[data-icon="stack"]').attributes('aria-label')).toBe('Group by stack');
    expect(wrapper.get('[data-icon="restart"]').attributes('aria-label')).toBe(
      'Recheck for updates',
    );
  });

  it('hides the column picker in cards mode and shows it in table mode', async () => {
    const context = makeTemplateContext({
      containerViewMode: writableRef<ViewMode>('cards'),
    });
    wrapper = mountWithContext(context);

    expect(wrapper.find('[data-test="data-table-column-picker"]').exists()).toBe(false);

    context.containerViewMode.value = 'table';
    await nextTick();

    expect(wrapper.find('[data-test="data-table-column-picker"]').exists()).toBe(true);
  });

  it('wires containerViewMode through the DataFilterBar v-model', async () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    const bar = wrapper.findComponent(DataFilterBarStub);
    expect(bar.props('modelValue')).toBe('table');

    await wrapper.find('[data-test="set-view-cards"]').trigger('click');
    expect(context.containerViewMode.value).toBe('cards');
    await nextTick();
    expect(bar.props('modelValue')).toBe('cards');

    await wrapper.find('[data-test="set-view-table"]').trigger('click');
    expect(context.containerViewMode.value).toBe('table');
  });

  it('renders toolbar sort in card mode with sortable non-icon columns and wires sort updates', async () => {
    const context = makeTemplateContext({
      containerViewMode: writableRef<ViewMode>('cards'),
      containerSortKey: writableRef('name'),
      containerSortAsc: writableRef(false),
    });
    wrapper = mountWithContext(context);

    const options = wrapper
      .find('[data-test="dd-toolbar-sort-select"]')
      .findAll('option:not([disabled])');
    expect(options.map((option) => option.attributes('value'))).toEqual(['name', 'status']);

    await wrapper.find('[data-test="dd-toolbar-sort-select"]').setValue('status');

    expect(context.containerSortKey.value).toBe('status');
    expect(context.containerSortAsc.value).toBe(true);

    await wrapper.find('[data-test="dd-toolbar-sort-direction"]').trigger('click');

    expect(context.containerSortAsc.value).toBe(false);
  });

  it('treats forced card reflow as card mode and hides the view toggle through DataFilterBar', () => {
    const context = makeTemplateContext({
      containerViewMode: writableRef<ViewMode>('table'),
      containerCardReflowForced: ref(true),
      tableColumns: computed<ContainersViewTableColumn[]>(() => [
        { key: 'icon', label: 'Icon', sortable: true, icon: true },
        { key: 'name', label: 'Container', sortable: true, icon: false },
        { key: 'fixed', label: 'Fixed', sortable: false, icon: false },
      ]),
    });
    wrapper = mountWithContext(context);

    const bar = wrapper.findComponent(DataFilterBarStub);
    expect(bar.props('hideViewToggle')).toBe(true);
    expect(wrapper.find('[data-test="dd-toolbar-sort-select"]').exists()).toBe(true);

    const options = wrapper
      .find('[data-test="dd-toolbar-sort-select"]')
      .findAll('option:not([disabled])');
    expect(options.map((option) => option.attributes('value'))).toEqual(['name']);
  });

  it('does not render toolbar sort in table mode when reflow is not forced', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    const bar = wrapper.findComponent(DataFilterBarStub);
    expect(bar.props('hideViewToggle')).toBe(false);
    expect(wrapper.find('[data-test="dd-toolbar-sort-select"]').exists()).toBe(false);
  });

  it('renders the version update kind option with its translated label', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    expect(wrapper.get('option[value="version"]').text()).toBe('Version Update');
  });

  it('shows the translated version update active-filter chip', () => {
    const context = makeTemplateContext({
      filterKind: ref('version'),
      activeFilterCount: computed(() => 1),
    });
    wrapper = mountWithContext(context);

    expect(wrapper.text()).toContain('Kind: Version Update');
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

  it('threads only picker-eligible auto-hidden columns to the picker (#display-honesty)', () => {
    const context = makeTemplateContext({
      // "icon" has no labelKey (not picker-eligible) — it should be dropped even though
      // it's in the auto-hidden set; "status" is picker-eligible and should survive.
      autoHiddenColumns: computed(() => [
        { key: 'status', label: 'Status', px: 'px-3', required: false },
        { key: 'icon', label: '', px: 'px-0', required: true },
      ]),
    });
    wrapper = mountWithContext(context);

    const picker = wrapper.findComponent(DataTableColumnPickerStub);
    expect(picker.props('autoHiddenKeys')).toEqual(['status']);
  });

  it('passes an empty auto-hidden set to the picker when nothing is auto-hidden', () => {
    const context = makeTemplateContext();
    wrapper = mountWithContext(context);

    const picker = wrapper.findComponent(DataTableColumnPickerStub);
    expect(picker.props('autoHiddenKeys')).toEqual([]);
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
