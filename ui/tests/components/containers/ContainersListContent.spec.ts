import type { VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, h, provide, ref } from 'vue';
import ContainersListContent from '@/components/containers/ContainersListContent.vue';
import {
  type ContainersViewTemplateContext,
  containersViewTemplateContextKey,
} from '@/components/containers/containersViewTemplateContext';
import { mountWithPlugins } from '../../helpers/mount';

function makeTemplateContext(): ContainersViewTemplateContext {
  return {
    error: ref(null),
    loading: ref(false),
    containerViewMode: ref('table') as any,
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
    showColumnPicker: ref(true),
    toggleColumnPicker: vi.fn(),
    columnPickerStyle: ref({
      position: 'fixed',
      top: '48px',
      left: '16px',
    }),
    allColumns: [
      { key: 'name', label: 'Container', required: true },
      { key: 'status', label: 'Status' },
    ] as any,
    toggleColumn: vi.fn(),
    visibleColumns: ref(new Set(['name', 'status'])),
    autoHiddenColumns: computed(() => []),
    tt: (label: string) => ({ value: label, showDelay: 0 }),
    groupByStack: ref(false) as any,
    rechecking: ref(false),
    recheckAll: vi.fn(),
    expandAllGroups: vi.fn(),
    collapseAllGroups: vi.fn(),
    allGroupsCollapsed: computed(() => false),
    filterContainerIds: ref(new Set()),
    clearContainerIdsFilter: vi.fn(),
  } as unknown as ContainersViewTemplateContext;
}

describe('ContainersListContent', () => {
  let host: HTMLElement | null = null;
  let wrapper: VueWrapper | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    host?.remove();
    host = null;
    document
      .querySelectorAll('[data-test="containers-column-picker"]')
      .forEach((element) => element.remove());
  });

  it('renders the column picker outside the list content stacking context', () => {
    const context = makeTemplateContext();

    const Parent = defineComponent({
      setup() {
        provide(containersViewTemplateContextKey, context);
        return () => h(ContainersListContent);
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    wrapper = mountWithPlugins(Parent, {
      attachTo: host,
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
        },
      },
    });

    const columnPicker = document.body.querySelector<HTMLElement>(
      '[data-test="containers-column-picker"]',
    );

    expect(columnPicker).not.toBeNull();
    expect(columnPicker?.parentElement).toBe(document.body);
    expect(columnPicker?.style.position).toBe('fixed');
    expect(wrapper.element.contains(columnPicker as HTMLElement)).toBe(false);
  });
});
