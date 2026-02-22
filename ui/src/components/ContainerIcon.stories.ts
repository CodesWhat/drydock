import type { Meta, StoryObj } from '@storybook/vue3';
import ContainerIcon from './ContainerIcon.vue';

const meta = {
  component: ContainerIcon,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof ContainerIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProxyIcon: Story = {
  args: {
    icon: 'sh-postgres',
    size: 20,
  },
};

export const Fallback: Story = {
  args: {
    icon: 'unknown-provider-icon',
    size: 20,
  },
};

export const SizeScale: Story = {
  render: () => ({
    components: { ContainerIcon },
    template: `
      <div class="flex items-center gap-4">
        <ContainerIcon icon="sh-nginx" :size="16" />
        <ContainerIcon icon="sh-nginx" :size="24" />
        <ContainerIcon icon="sh-nginx" :size="32" />
      </div>
    `,
  }),
};
