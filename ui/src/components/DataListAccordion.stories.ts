import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from 'storybook/test';
import DataListAccordion from './DataListAccordion.vue';

interface WatcherItem {
  id: string;
  name: string;
  endpoint: string;
  status: 'connected' | 'disconnected';
  containers: number;
}

const watchers: WatcherItem[] = [
  {
    id: 'local',
    name: 'Local Docker',
    endpoint: 'unix:///var/run/docker.sock',
    status: 'connected',
    containers: 18,
  },
  {
    id: 'edge-1',
    name: 'Edge Cluster 1',
    endpoint: 'tcp://10.42.0.12:2376',
    status: 'connected',
    containers: 9,
  },
  {
    id: 'edge-2',
    name: 'Edge Cluster 2',
    endpoint: 'tcp://10.42.0.13:2376',
    status: 'disconnected',
    containers: 0,
  },
];

const meta = {
  component: DataListAccordion,
  tags: ['autodocs'],
  args: {
    onToggle: fn(),
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; max-width: 1100px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof DataListAccordion>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderAccordion = (args: Story['args']) => ({
  components: { DataListAccordion },
  setup() {
    return { args };
  },
  template: `
    <DataListAccordion v-bind="args">
      <template #header="{ item }">
        <div class="w-2.5 h-2.5 rounded-full"
             :style="{ backgroundColor: item.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
        <AppIcon name="servers" :size="12" class="dd-text-secondary" />
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ item.name }}</span>
        <span class="text-[10px] font-mono dd-text-muted hidden sm:inline">{{ item.endpoint }}</span>
      </template>
      <template #details="{ item }">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
            <div class="text-[12px] font-semibold"
                 :style="{ color: item.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
              {{ item.status }}
            </div>
          </div>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Containers</div>
            <div class="text-[12px] dd-text">{{ item.containers }}</div>
          </div>
          <div class="sm:col-span-2">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Endpoint</div>
            <div class="text-[12px] font-mono dd-text">{{ item.endpoint }}</div>
          </div>
        </div>
      </template>
    </DataListAccordion>
  `,
});

export const Default: Story = {
  args: {
    items: watchers,
    itemKey: 'id',
    onToggle: fn(),
  },
  render: renderAccordion,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Edge Cluster 1'));
    await expect((args as Record<string, any>).onToggle).toHaveBeenCalledWith('edge-1');
    await expect(canvas.getByText('Endpoint')).toBeInTheDocument();
  },
};

export const SelectedItem: Story = {
  args: {
    items: watchers,
    itemKey: 'id',
    selectedKey: 'edge-1',
  },
  render: renderAccordion,
};

export const FunctionKey: Story = {
  args: {
    items: watchers,
    itemKey: (item: WatcherItem) => item.id,
    selectedKey: 'local',
  },
  render: renderAccordion,
};
