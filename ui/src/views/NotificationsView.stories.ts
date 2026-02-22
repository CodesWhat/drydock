import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import NotificationsView from './NotificationsView.vue';

interface TriggerApiItem {
  id: string;
  name: string;
}

const triggerFixtures: TriggerApiItem[] = [
  { id: 'trig-slack', name: 'Slack Alerts' },
  { id: 'trig-smtp', name: 'SMTP Reports' },
  { id: 'trig-http', name: 'Ops Webhook' },
];

function installNotificationsMock(data: TriggerApiItem[]) {
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
  component: NotificationsView,
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
} satisfies Meta<typeof NotificationsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installNotificationsMock(triggerFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Update Available')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Slack Alerts')).toBeInTheDocument();
  },
};

export const CardsAndFilter: Story = {
  loaders: [
    async () => {
      installNotificationsMock(triggerFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Security Alert')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('Agent Disconnected')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'security');
    await expect(canvas.getByText('Security Alert')).toBeInTheDocument();
  },
};

