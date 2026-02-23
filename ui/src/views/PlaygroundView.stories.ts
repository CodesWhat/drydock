import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import PlaygroundView from './PlaygroundView.vue';

function resetPlaygroundState() {
  localStorage.removeItem('drydock-radius');
  document.documentElement.style.removeProperty('--dd-radius');
  document.documentElement.style.removeProperty('--dd-radius-sm');
  document.documentElement.style.removeProperty('--dd-radius-lg');
}

const meta = {
  component: PlaygroundView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; min-height: 1000px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof PlaygroundView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  loaders: [
    async () => {
      resetPlaygroundState();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Color Theme')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Border Radius')).toBeInTheDocument();
    await expect(canvas.getByText('Brand Spinner')).toBeInTheDocument();
  },
};

export const ComponentsTab: Story = {
  loaders: [
    async () => {
      resetPlaygroundState();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Components/ })).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByRole('button', { name: /Components/ }));

    await waitFor(() => {
      expect(canvas.getByText('Buttons')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Container Cards')).toBeInTheDocument();
    await expect(canvas.getByText('Tooltips & Confirm Dialogs')).toBeInTheDocument();
  },
};

export const TokensTab: Story = {
  loaders: [
    async () => {
      resetPlaygroundState();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Tokens/ })).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByRole('button', { name: /Tokens/ }));

    await waitFor(() => {
      expect(canvas.getByText('Color Tokens')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Typography')).toBeInTheDocument();
    await expect(canvas.getByText('Terminal / Log View')).toBeInTheDocument();
    await expect(canvas.getByText('Status Bar')).toBeInTheDocument();
  },
};

export const RadiusPresets: Story = {
  loaders: [
    async () => {
      resetPlaygroundState();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Round' })).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByRole('button', { name: 'Round' }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--dd-radius')).toBe('16px');
    });
  },
};

export const ConfirmDialogFlow: Story = {
  loaders: [
    async () => {
      resetPlaygroundState();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    // Navigate to Components tab first
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Components/ })).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: /Components/ }));

    await waitFor(() => {
      expect(canvas.getByText('Confirm Dialogs (click)')).toBeInTheDocument();
    });

    const heading = canvas.getByText('Confirm Dialogs (click)');
    const section = heading.parentElement;
    const stopAction = section?.querySelector('button');

    expect(stopAction).not.toBeNull();
    await userEvent.click(stopAction as HTMLButtonElement);

    await waitFor(() => {
      expect(body.getByText('Stop nginx-proxy?')).toBeInTheDocument();
    });

    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(canvas.getByText('Result: Cancelled stop')).toBeInTheDocument();
    });
  },
};
