import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from 'storybook/test';
import DataCardGrid from './DataCardGrid.vue';

interface ServiceCard {
  id: string;
  name: string;
  server: string;
  status: 'healthy' | 'degraded' | 'offline';
  updates: number;
}

const services: ServiceCard[] = [
  { id: 'gateway', name: 'API Gateway', server: 'edge-1', status: 'healthy', updates: 0 },
  { id: 'worker', name: 'Background Worker', server: 'edge-2', status: 'degraded', updates: 2 },
  { id: 'reports', name: 'Reports Service', server: 'edge-3', status: 'offline', updates: 1 },
];

const meta = {
  component: DataCardGrid,
  tags: ['autodocs'],
  args: {
    onItemClick: fn(),
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; max-width: 1100px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof DataCardGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: services,
    itemKey: 'id',
    minWidth: '260px',
    onItemClick: fn(),
  },
  render: (args) => ({
    components: { DataCardGrid },
    setup() {
      return { args };
    },
    template: `
      <DataCardGrid v-bind="args">
        <template #card="{ item, selected }">
          <div class="px-4 py-3 flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[13px] font-semibold truncate dd-text">{{ item.name }}</div>
              <div class="text-[11px] mt-0.5 dd-text-muted">server: {{ item.server }}</div>
            </div>
            <span class="text-[9px] uppercase font-bold px-2 py-1 dd-rounded shrink-0"
                  :style="{
                    backgroundColor:
                      item.status === 'healthy'
                        ? 'var(--dd-success-muted)'
                        : item.status === 'degraded'
                          ? 'var(--dd-warning-muted)'
                          : 'var(--dd-danger-muted)',
                    color:
                      item.status === 'healthy'
                        ? 'var(--dd-success)'
                        : item.status === 'degraded'
                          ? 'var(--dd-warning)'
                          : 'var(--dd-danger)',
                  }">
              {{ item.status }}
            </span>
          </div>
          <div class="px-4 pb-3 text-[11px] dd-text-secondary">
            {{ item.updates }} pending update{{ item.updates === 1 ? '' : 's' }}
          </div>
          <div class="px-4 py-2.5 mt-auto text-[10px] dd-text-muted"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: selected ? 'var(--dd-bg-elevated)' : 'var(--dd-bg-inset)' }">
            {{ selected ? 'Selected for details' : 'Click to open details' }}
          </div>
        </template>
      </DataCardGrid>
    `,
  }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Background Worker'));
    await expect((args as Record<string, unknown>).onItemClick).toHaveBeenCalledWith(services[1]);
  },
};

export const SelectedCard: Story = {
  args: {
    items: services,
    itemKey: 'id',
    selectedKey: 'worker',
    minWidth: '260px',
  },
  render: Default.render,
};

export const NarrowCards: Story = {
  args: {
    items: services,
    itemKey: 'id',
    minWidth: '200px',
  },
  render: Default.render,
};

export const FunctionKey: Story = {
  args: {
    items: services,
    itemKey: (item: ServiceCard) => item.id,
    selectedKey: 'reports',
    minWidth: '260px',
  },
  render: Default.render,
};
