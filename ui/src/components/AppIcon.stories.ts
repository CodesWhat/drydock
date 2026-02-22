import type { Meta, StoryObj } from '@storybook/vue3';
import AppIcon from './AppIcon.vue';

const meta = {
  component: AppIcon,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof AppIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: 'servers',
    size: 16,
  },
};

export const CommonIcons: Story = {
  render: () => ({
    components: { AppIcon },
    template: `
      <div class="flex flex-wrap gap-4">
        <div v-for="name in ['servers', 'table', 'grid', 'list', 'filter', 'xmark']"
             :key="name"
             class="px-3 py-2 dd-rounded flex items-center gap-2"
             :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
          <AppIcon :name="name" :size="14" />
          <span class="text-[11px] dd-text-muted">{{ name }}</span>
        </div>
      </div>
    `,
  }),
};

