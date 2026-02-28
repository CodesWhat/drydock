import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from 'storybook/test';
import DataTable from './DataTable.vue';

interface SampleRow {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  server: string;
  updates: number;
}

const columns = [
  { key: 'name', label: 'Container', width: '44%' },
  { key: 'status', label: 'Status', align: 'text-center' },
  { key: 'server', label: 'Server', align: 'text-center' },
  { key: 'updates', label: 'Updates', align: 'text-right' },
];

const columnsWithIcon = [
  { key: 'icon', label: '', icon: true, width: '44px', sortable: false },
  ...columns,
];

const rows: SampleRow[] = [
  { id: 'api', name: 'drydock-api', status: 'running', server: 'local', updates: 0 },
  { id: 'web', name: 'drydock-web', status: 'running', server: 'edge-1', updates: 2 },
  { id: 'db', name: 'postgres', status: 'stopped', server: 'edge-2', updates: 1 },
];

const meta = {
  component: DataTable,
  tags: ['autodocs'],
  args: {
    'onUpdate:sortKey': fn(),
    'onUpdate:sortAsc': fn(),
    onRowClick: fn(),
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; max-width: 1100px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    columns,
    rows,
    rowKey: 'id',
    sortKey: 'name',
    sortAsc: true,
    selectedKey: 'web',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const listeners = args as Record<string, unknown>;

    await userEvent.click(canvas.getByText('Container'));
    await expect(listeners['onUpdate:sortAsc']).toHaveBeenCalledWith(false);

    await userEvent.click(canvas.getByText('drydock-web'));
    await expect(listeners.onRowClick).toHaveBeenCalledWith(rows[1]);
  },
};

export const WithCustomCellsAndActions: Story = {
  args: {
    columns,
    rows,
    rowKey: 'id',
    sortKey: 'updates',
    sortAsc: false,
    showActions: true,
    onRowClick: fn(),
  },
  render: (args) => ({
    components: { DataTable },
    setup() {
      return { args };
    },
    template: `
      <DataTable v-bind="args">
        <template #cell-name="{ row }">
          <div class="flex items-center gap-2">
            <AppIcon name="box" :size="12" class="dd-text-secondary" />
            <span class="font-medium dd-text">{{ row.name }}</span>
          </div>
        </template>
        <template #cell-status="{ row }">
          <span class="badge text-[9px] font-bold uppercase"
                :style="{
                  backgroundColor: row.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: row.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ row.status }}
          </span>
        </template>
        <template #actions="{ row }">
          <button class="px-2 py-1 text-[10px] dd-rounded dd-bg-elevated dd-text-muted hover:dd-text">
            Open {{ row.id }}
          </button>
        </template>
      </DataTable>
    `,
  }),
};

export const Empty: Story = {
  args: {
    columns,
    rows: [],
    rowKey: 'id',
    sortKey: 'name',
    sortAsc: true,
  },
  render: (args) => ({
    components: { DataTable },
    setup() {
      return { args };
    },
    template: `
      <DataTable v-bind="args">
        <template #empty>
          <div class="p-6">
            <EmptyState
              icon="search"
              message="No containers match the current filters"
              :show-clear="true"
            />
          </div>
        </template>
      </DataTable>
    `,
  }),
};

export const IconColumn: Story = {
  args: {
    columns: columnsWithIcon,
    rows,
    rowKey: 'id',
    sortKey: 'name',
    sortAsc: true,
    compact: true,
  },
  render: (args) => ({
    components: { DataTable },
    setup() {
      return { args };
    },
    template: `
      <DataTable v-bind="args">
        <template #cell-icon="{ row }">
          <AppIcon :name="row.status === 'running' ? 'play' : 'stop'" :size="11" />
        </template>
      </DataTable>
    `,
  }),
};
