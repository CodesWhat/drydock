import type { Meta, StoryObj } from '@storybook/vue3';
import DataFilterBar from './DataFilterBar.vue';

const meta = {
  component: DataFilterBar,
  tags: ['autodocs'],
} satisfies Meta<typeof DataFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 12,
    totalCount: 42,
    showFilters: false,
  },
};

export const WithActiveFilters: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 5,
    totalCount: 42,
    showFilters: true,
    activeFilterCount: 3,
  },
};

export const CardsView: Story = {
  args: {
    modelValue: 'cards',
    filteredCount: 42,
    totalCount: 42,
    showFilters: false,
  },
};

export const ListView: Story = {
  args: {
    modelValue: 'list',
    filteredCount: 42,
    totalCount: 42,
    showFilters: false,
  },
};

export const WithCountLabel: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 8,
    totalCount: 15,
    showFilters: false,
    countLabel: 'watchers',
  },
};

export const HiddenFilter: Story = {
  args: {
    modelValue: 'table',
    filteredCount: 10,
    totalCount: 10,
    showFilters: false,
    hideFilter: true,
  },
};
