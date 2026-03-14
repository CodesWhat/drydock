import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import TriggersView from './TriggersView.vue';

interface TriggerApiItem {
  id: string;
  name: string;
  type: string;
  configuration: Record<string, string>;
}

const TRIGGERS_PATH = '/api/triggers';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const triggerFixtureRows = [
  [
    't-slack',
    'Slack Alerts',
    'slack',
    { channel: '#alerts', webhook: 'https://hooks.slack.com/services/xxx' },
  ],
  ['t-email', 'SMTP Reports', 'smtp', { host: 'smtp.example.com', from: 'drydock@example.com' }],
  [
    't-webhook',
    'Webhook Fanout',
    'http',
    { method: 'POST', endpoint: 'https://ops.example.com/hooks/drydock' },
  ],
] as const;

const triggerFixtures: TriggerApiItem[] = triggerFixtureRows.map(
  ([id, name, type, configuration]) => ({
    id,
    name,
    type,
    configuration,
  }),
);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function resolvePath(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.pathname;
  }
  if (typeof input === 'string') {
    return new URL(input, 'http://localhost').pathname;
  }
  return new URL(input.url, 'http://localhost').pathname;
}

function installTriggersMock(data: readonly TriggerApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const path = resolvePath(input);
    if (path === TRIGGERS_PATH) {
      return jsonResponse(data);
    }
    return jsonResponse({ error: `No mock for ${path}` }, 404);
  };
}

function createLoaders(data: readonly TriggerApiItem[]) {
  return [
    async () => {
      installTriggersMock(data);
      return {};
    },
  ];
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
  loaders: createLoaders(triggerFixtures),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Slack Alerts')).toBeInTheDocument();
    });
    await expect(canvas.getByText('SMTP Reports')).toBeInTheDocument();
  },
};

export const ListMode: Story = {
  loaders: createLoaders(triggerFixtures),
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
  loaders: createLoaders([]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('No triggers match your filters')).toBeInTheDocument();
    });
  },
};
