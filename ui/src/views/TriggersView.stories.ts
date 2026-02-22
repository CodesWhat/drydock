import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import TriggersView from './TriggersView.vue';

interface TriggerApiItem {
  id: string;
  name: string;
  type: string;
  configuration: Record<string, string>;
}

const triggerFixtures: TriggerApiItem[] = [
  {
    id: 't-slack',
    name: 'Slack Alerts',
    type: 'slack',
    configuration: { channel: '#alerts', webhook: 'https://hooks.slack.com/services/xxx' },
  },
  {
    id: 't-email',
    name: 'SMTP Reports',
    type: 'smtp',
    configuration: { host: 'smtp.example.com', from: 'drydock@example.com' },
  },
  {
    id: 't-webhook',
    name: 'Webhook Fanout',
    type: 'http',
    configuration: { method: 'POST', endpoint: 'https://ops.example.com/hooks/drydock' },
  },
];

function installTriggersMock(data: TriggerApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/triggers') {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `No mock for ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const meta = {
  component: TriggersView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; min-height: 820px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof TriggersView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installTriggersMock(triggerFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Slack Alerts')).toBeInTheDocument();
    });
    await expect(canvas.getByText('SMTP Reports')).toBeInTheDocument();
  },
};

export const ListMode: Story = {
  loaders: [
    async () => {
      installTriggersMock(triggerFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Webhook Fanout')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('List view'));
    await userEvent.click(canvas.getByText('Webhook Fanout'));
    await expect(canvas.getByText('endpoint')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      installTriggersMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('No triggers match your filters')).toBeInTheDocument();
    });
  },
};

