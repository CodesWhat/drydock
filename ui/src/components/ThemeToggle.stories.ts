import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ThemeToggle from './ThemeToggle.vue';
import { useTheme } from '../theme/useTheme';

const meta = {
  component: ThemeToggle,
  tags: ['autodocs'],
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 2rem; display: flex; gap: 2rem;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = {
  args: { size: 'sm' },
};

export const Medium: Story = {
  args: { size: 'md' },
};

export const Dark: Story = {
  args: { size: 'md' },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div class="dark"><story /></div>',
    }),
  ],
};

export const Light: Story = {
  args: { size: 'md' },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div class="light"><story /></div>',
    }),
  ],
};

export const SwitchVariant: Story = {
  args: { size: 'md' },
  render: (args) => ({
    components: { ThemeToggle },
    setup() {
      const { setThemeVariant } = useTheme();
      setThemeVariant('dark');
      return { args };
    },
    template: '<div style="padding: 2rem;"><ThemeToggle v-bind="args" /></div>',
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle('Light'));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  },
};
