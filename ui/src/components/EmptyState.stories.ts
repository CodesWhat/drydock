import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from 'storybook/test';
import EmptyState from './EmptyState.vue';

const meta = {
  component: EmptyState,
  tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: 'No containers found',
  },
};

export const CustomIcon: Story = {
  args: {
    icon: 'search',
    message: 'No results match your search',
  },
};

export const WithClearButton: Story = {
  args: {
    icon: 'filter',
    message: 'No containers match the active filters',
    showClear: true,
    onClear: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Clear all filters' }));
    await expect((args as Record<string, unknown>).onClear).toHaveBeenCalled();
  },
};
