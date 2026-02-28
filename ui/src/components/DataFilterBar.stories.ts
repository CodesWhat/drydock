import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from 'storybook/test';
import DataFilterBar from './DataFilterBar.vue';

const meta = {
  component: DataFilterBar,
  tags: ['autodocs'],
  args: {
    'onUpdate:modelValue': fn(),
    'onUpdate:showFilters': fn(),
  },
} satisfies Meta<typeof DataFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const renderWithFilters = (args: Story['args']) => ({
  components: { DataFilterBar },
  setup() {
    return { args };
  },
  template: `
    <div style="padding: 1rem; max-width: 1100px;">
      <DataFilterBar v-bind="args">
        <template #filters>
          <input
            type="text"
            placeholder="Filter by name..."
            class="flex-1 min-w-[120px] max-w-[240px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder"
          />
          <button class="text-[10px] dd-text-muted hover:dd-text transition-colors">Clear</button>
        </template>
      </DataFilterBar>
    </div>
  `,
});

export const Default: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 12,
    totalCount: 42,
    showFilters: false,
  },
  render: renderWithFilters,
};

export const WithActiveFilters: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 5,
    totalCount: 42,
    showFilters: true,
    activeFilterCount: 3,
  },
  render: renderWithFilters,
};

export const CardsView: Story = {
  args: {
    modelValue: 'cards',
    filteredCount: 42,
    totalCount: 42,
    showFilters: false,
  },
  render: renderWithFilters,
};

export const ListView: Story = {
  args: {
    modelValue: 'list',
    filteredCount: 42,
    totalCount: 42,
    showFilters: false,
  },
  render: renderWithFilters,
};

export const WithCountLabel: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 8,
    totalCount: 15,
    showFilters: false,
    countLabel: 'watchers',
  },
  render: renderWithFilters,
};

export const HiddenFilter: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 10,
    totalCount: 10,
    showFilters: false,
    hideFilter: true,
  },
  render: renderWithFilters,
};

export const InteractionSmoke: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 12,
    totalCount: 42,
    showFilters: false,
    activeFilterCount: 2,
    'onUpdate:modelValue': fn(),
    'onUpdate:showFilters': fn(),
  },
  render: renderWithFilters,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const listeners = args as Record<string, unknown>;

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(listeners['onUpdate:modelValue']).toHaveBeenCalledWith('cards');

    await userEvent.click(canvas.getByTitle('Filters'));
    await expect(listeners['onUpdate:showFilters']).toHaveBeenCalledWith(true);
  },
};
