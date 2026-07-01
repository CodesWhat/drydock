import { defineComponent } from 'vue';

export const dataViewStubs: Record<string, any> = {
  RouterLink: defineComponent({
    props: ['to'],
    template: '<a class="router-link-stub"><slot /></a>',
  }),
  DataViewLayout: defineComponent({
    template: '<div class="data-view-layout"><slot /><slot name="panel" /></div>',
  }),
  DataFilterBar: defineComponent({
    props: ['modelValue', 'showFilters', 'filteredCount', 'totalCount', 'activeFilterCount'],
    emits: ['update:modelValue', 'update:showFilters'],
    template: `
      <div class="data-filter-bar">
        <button class="mode-table" @click="$emit('update:modelValue', 'table')">Table</button>
        <button class="mode-cards" @click="$emit('update:modelValue', 'cards')">Cards</button>
        <button class="mode-list" @click="$emit('update:modelValue', 'list')">List</button>
        <slot name="left" />
        <slot name="filters" />
        <slot name="extra-buttons" />
      </div>
    `,
  }),
  DataTable: defineComponent({
    props: ['columns', 'rows', 'rowKey', 'activeRow', 'selectedKey', 'sortKey', 'sortAsc'],
    emits: ['row-click', 'update:sort-key', 'update:sort-asc'],
    template: `
      <div class="data-table"
           :data-row-count="rows?.length ?? 0"
           :data-selected-key="selectedKey || activeRow || ''">
        <button v-if="rows?.[0]" class="row-click-first" @click="$emit('row-click', rows[0])">Open 1</button>
        <button v-if="rows?.[1]" class="row-click-second" @click="$emit('row-click', rows[1])">Open 2</button>
        <div v-if="rows?.[0]" data-cell="status"><slot name="cell-status" :row="rows[0]" /></div>
        <slot name="empty" v-if="!rows || rows.length === 0" />
      </div>
    `,
  }),
  DetailPanel: defineComponent({
    props: ['open', 'isMobile', 'size', 'showSizeControls', 'showFullPage'],
    emits: ['update:open'],
    template: `
      <div class="detail-panel" :data-open="String(open)">
        <button class="close-detail" @click="$emit('update:open', false)">Close</button>
        <div class="detail-header"><slot name="header" /></div>
        <div class="detail-subtitle"><slot name="subtitle" /></div>
        <div class="detail-tabs"><slot name="tabs" /></div>
        <div class="detail-content"><slot /></div>
      </div>
    `,
  }),
  EmptyState: defineComponent({
    props: ['icon', 'message', 'showClear'],
    emits: ['clear'],
    template: `
      <div class="empty-state">
        <span>{{ message }}</span>
        <button v-if="showClear" class="clear-empty" @click="$emit('clear')">Clear</button>
      </div>
    `,
  }),
};
