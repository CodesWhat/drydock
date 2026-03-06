import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import NotificationsView from './NotificationsView.vue';

interface TriggerApiItem {
  id: string;
  name: string;
  type: string;
}

interface NotificationRuleApiItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
}

const triggerFixtures: TriggerApiItem[] = [
  { id: 'trig-slack', name: 'Slack Alerts', type: 'slack' },
  { id: 'trig-smtp', name: 'SMTP Reports', type: 'smtp' },
  { id: 'trig-http', name: 'Ops Webhook', type: 'http' },
];

const notificationFixtures: NotificationRuleApiItem[] = [
  {
    id: 'update-available',
    name: 'Update Available',
    description: 'When a container has a new version',
    enabled: true,
    triggers: ['trig-slack', 'trig-smtp'],
  },
  {
    id: 'update-applied',
    name: 'Update Applied',
    description: 'After a container is successfully updated',
    enabled: true,
    triggers: ['trig-http'],
  },
  {
    id: 'update-failed',
    name: 'Update Failed',
    description: 'When an update fails or is rolled back',
    enabled: true,
    triggers: ['trig-slack'],
  },
  {
    id: 'security-alert',
    name: 'Security Alert',
    description: 'Critical/High vulnerability detected',
    enabled: true,
    triggers: ['trig-smtp'],
  },
  {
    id: 'agent-disconnect',
    name: 'Agent Disconnected',
    description: 'When a remote agent loses connection',
    enabled: false,
    triggers: [],
  },
];

function installNotificationsMock(rules: NotificationRuleApiItem[], triggers: TriggerApiItem[]) {
  const inMemoryRules = rules.map((rule) => ({ ...rule, triggers: [...rule.triggers] }));

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;
    const method = init?.method?.toUpperCase() || 'GET';

    if (path === '/api/triggers' && method === 'GET') {
      return new Response(JSON.stringify(triggers), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/notifications' && method === 'GET') {
      return new Response(JSON.stringify(inMemoryRules), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path.startsWith('/api/notifications/') && method === 'PATCH') {
      const id = path.replace('/api/notifications/', '');
      const index = inMemoryRules.findIndex((rule) => rule.id === id);
      if (index < 0) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const body = init?.body ? JSON.parse(init.body as string) : {};
      inMemoryRules[index] = {
        ...inMemoryRules[index],
        ...body,
        triggers: Array.isArray(body.triggers)
          ? [...new Set(body.triggers)]
          : inMemoryRules[index].triggers,
      };

      return new Response(JSON.stringify(inMemoryRules[index]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `No mock for ${method} ${path}` }), {
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
      installNotificationsMock(notificationFixtures, triggerFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Update Available')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Slack Alerts')).toBeInTheDocument();
    await expect(canvas.getByText('Security Alert')).toBeInTheDocument();
  },
};

export const CardsAndEditRule: Story = {
  loaders: [
    async () => {
      installNotificationsMock(notificationFixtures, triggerFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Agent Disconnected')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('Update Failed')).toBeInTheDocument();

    await userEvent.click(canvas.getByText('Update Available'));
    await waitFor(() => {
      expect(canvas.getByText('Assigned Triggers')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByLabelText('Ops Webhook'));
    await userEvent.click(canvas.getByText('Save changes'));
  },
};
