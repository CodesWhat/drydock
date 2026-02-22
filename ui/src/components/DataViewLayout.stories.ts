import type { Meta, StoryObj } from '@storybook/vue3';
import { computed, ref } from 'vue';
import { expect, userEvent, within } from 'storybook/test';
import DataCardGrid from './DataCardGrid.vue';
import DataFilterBar from './DataFilterBar.vue';
import DataListAccordion from './DataListAccordion.vue';
import DataTable from './DataTable.vue';
import DataViewLayout from './DataViewLayout.vue';
import DetailPanel from './DetailPanel.vue';

const meta = {
  component: DataViewLayout,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="height: 780px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof DataViewLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ContentOnly: Story = {
  render: () => ({
    components: { DataViewLayout },
    template: `
      <DataViewLayout>
        <div class="space-y-4">
          <div class="px-3 py-2 dd-rounded flex items-center justify-between"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <span class="text-xs font-semibold dd-text">Containers</span>
            <span class="text-[10px] dd-text-muted">14 / 23 visible</span>
          </div>
          <div class="dd-rounded p-4"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="h-[520px] grid gap-2 content-start">
              <div v-for="i in 10" :key="i" class="h-10 dd-rounded"
                   :style="{ backgroundColor: i % 2 === 0 ? 'var(--dd-bg-inset)' : 'var(--dd-bg)' }" />
            </div>
          </div>
        </div>
      </DataViewLayout>
    `,
  }),
};

export const WithDetailPanelSlot: Story = {
  render: () => ({
    components: { DataViewLayout },
    template: `
      <DataViewLayout>
        <div class="space-y-4">
          <div class="px-3 py-2 dd-rounded flex items-center justify-between"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <span class="text-xs font-semibold dd-text">Servers</span>
            <span class="text-[10px] dd-text-muted">3 connected, 1 disconnected</span>
          </div>
          <div class="dd-rounded p-4"
               :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
            <div class="h-[520px] grid gap-2 content-start">
              <div v-for="i in 8" :key="i" class="h-12 dd-rounded"
                   :style="{ backgroundColor: i % 2 === 0 ? 'var(--dd-bg-inset)' : 'var(--dd-bg)' }" />
            </div>
          </div>
        </div>
        <template #panel>
          <aside class="dd-rounded mr-4 mt-4 mb-4 overflow-hidden flex flex-col"
                 :style="{
                   flex: '0 0 38%',
                   minHeight: '400px',
                   border: '1px solid var(--dd-border-strong)',
                   backgroundColor: 'var(--dd-bg-card)',
                 }">
            <div class="px-4 py-3 flex items-center justify-between"
                 :style="{ borderBottom: '1px solid var(--dd-border)' }">
              <span class="text-sm font-semibold dd-text">Detail Panel Slot</span>
              <button class="w-7 h-7 dd-rounded dd-text-muted hover:dd-text hover:dd-bg-elevated">
                <AppIcon name="xmark" :size="12" />
              </button>
            </div>
            <div class="p-4 space-y-2">
              <div class="text-[10px] uppercase tracking-wider font-semibold dd-text-muted">Selection</div>
              <div class="text-xs font-mono dd-text">edge-1 / drydock-api</div>
            </div>
          </aside>
        </template>
      </DataViewLayout>
    `,
  }),
};

interface WorkspaceRow {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  server: string;
}

const workspaceRows: WorkspaceRow[] = [
  { id: 'api', name: 'drydock-api', status: 'running', server: 'edge-1' },
  { id: 'web', name: 'drydock-web', status: 'running', server: 'edge-2' },
  { id: 'db', name: 'postgres', status: 'stopped', server: 'edge-1' },
  { id: 'worker', name: 'queue-worker', status: 'running', server: 'edge-3' },
];

export const IntegratedWorkspace: Story = {
  render: () => ({
    components: {
      DataViewLayout,
      DataFilterBar,
      DataTable,
      DataCardGrid,
      DataListAccordion,
      DetailPanel,
    },
    setup() {
      const viewMode = ref<'table' | 'cards' | 'list'>('table');
      const showFilters = ref(false);
      const query = ref('');
      const selectedId = ref<string | null>(null);
      const panelOpen = ref(false);
      const panelSize = ref<'sm' | 'md' | 'lg'>('sm');

      const filteredRows = computed(() => {
        if (!query.value) return workspaceRows;
        const q = query.value.toLowerCase();
        return workspaceRows.filter(
          (row) => row.name.toLowerCase().includes(q) || row.server.toLowerCase().includes(q),
        );
      });
      const selected = computed(() => filteredRows.value.find((row) => row.id === selectedId.value) ?? null);

      const columns = [
        { key: 'name', label: 'Container', width: '45%' },
        { key: 'status', label: 'Status', align: 'text-center' },
        { key: 'server', label: 'Server', align: 'text-center' },
      ];

      function openDetails(row: WorkspaceRow) {
        selectedId.value = row.id;
        panelOpen.value = true;
      }

      return {
        columns,
        filteredRows,
        openDetails,
        panelOpen,
        panelSize,
        query,
        selected,
        selectedId,
        showFilters,
        viewMode,
        workspaceRows,
      };
    },
    template: `
      <DataViewLayout>
        <DataFilterBar
          v-model="viewMode"
          v-model:showFilters="showFilters"
          :filtered-count="filteredRows.length"
          :total-count="workspaceRows.length"
          :active-filter-count="query ? 1 : 0"
        >
          <template #filters>
            <input
              v-model="query"
              type="text"
              placeholder="Filter by name or server..."
              class="flex-1 min-w-[120px] max-w-[260px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder"
            />
            <button
              class="text-[10px] dd-text-muted hover:dd-text transition-colors"
              @click="query = ''"
            >
              Clear
            </button>
          </template>
        </DataFilterBar>

        <DataTable
          v-if="viewMode === 'table'"
          :columns="columns"
          :rows="filteredRows"
          row-key="id"
          :selected-key="selectedId"
          @row-click="openDetails($event)"
        >
          <template #cell-status="{ row }">
            <span class="badge text-[9px] uppercase font-bold"
                  :style="{
                    backgroundColor: row.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: row.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ row.status }}
            </span>
          </template>
        </DataTable>

        <DataCardGrid
          v-if="viewMode === 'cards'"
          :items="filteredRows"
          item-key="id"
          :selected-key="selectedId"
          @item-click="openDetails($event)"
        >
          <template #card="{ item, selected }">
            <div class="px-4 py-3">
              <div class="text-sm font-semibold dd-text">{{ item.name }}</div>
              <div class="text-[11px] dd-text-muted mt-1">{{ item.server }}</div>
            </div>
            <div class="px-4 py-2.5 text-[10px] dd-text-muted"
                 :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: selected ? 'var(--dd-bg-elevated)' : 'var(--dd-bg-inset)' }">
              {{ item.status }}
            </div>
          </template>
        </DataCardGrid>

        <DataListAccordion
          v-if="viewMode === 'list'"
          :items="filteredRows"
          item-key="id"
          :selected-key="selectedId"
        >
          <template #header="{ item }">
            <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ item.name }}</span>
            <span class="text-[10px] font-mono dd-text-muted">{{ item.server }}</span>
          </template>
          <template #details="{ item }">
            <div class="text-xs dd-text">Status: {{ item.status }}</div>
          </template>
        </DataListAccordion>

        <template #panel>
          <DetailPanel
            :open="panelOpen && !!selected"
            :is-mobile="false"
            :size="panelSize"
            :show-size-controls="true"
            :show-full-page="false"
            @update:open="panelOpen = $event"
            @update:size="panelSize = $event"
          >
            <template #header>
              <div class="text-sm font-semibold dd-text">Selection</div>
            </template>
            <template #subtitle>
              <span class="text-[11px] font-mono dd-text-secondary">{{ selected?.name }}</span>
            </template>
            <div class="p-4 text-xs dd-text-muted">
              Server: {{ selected?.server }}<br />
              Status: {{ selected?.status }}
            </div>
          </DetailPanel>
        </template>
      </DataViewLayout>
    `,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('drydock-web'));
    await expect(canvas.getByText('Selection')).toBeInTheDocument();
    await expect(canvas.getByText('drydock-web')).toBeInTheDocument();
    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('queue-worker')).toBeInTheDocument();
  },
};
