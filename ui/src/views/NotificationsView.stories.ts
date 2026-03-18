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

interface StoryMockRequest {
  path: string;
  method: string;
  bodyText?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

async function resolveBodyText(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  if (init?.body !== undefined && init.body !== null) {
    return String(init.body);
  }

  if (input instanceof Request) {
    return await input.text();
  }

  return undefined;
}

async function parseRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<StoryMockRequest> {
  let raw: string;
  if (typeof input === 'string') {
    raw = input;
  } else if (input instanceof URL) {
    raw = input.toString();
  } else {
    raw = input.url;
  }

  const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const bodyText = await resolveBodyText(input, init);

  return { path: url.pathname, method, bodyText };
}

function parsePatchBody(request: StoryMockRequest): Partial<NotificationRuleApiItem> {
  if (!request.bodyText) {
    return {};
  }
  return JSON.parse(request.bodyText) as Partial<NotificationRuleApiItem>;
}

function mergeRuleUpdate(
  rule: NotificationRuleApiItem,
  body: Partial<NotificationRuleApiItem>,
): NotificationRuleApiItem {
  return {
    ...rule,
    ...body,
    triggers: Array.isArray(body.triggers) ? [...new Set(body.triggers)] : rule.triggers,
  };
}

function handleGetRequest(
  request: StoryMockRequest,
  rules: NotificationRuleApiItem[],
  triggers: TriggerApiItem[],
): Response | undefined {
  if (request.path === '/api/v1/triggers') {
    return jsonResponse(triggers);
  }

  if (request.path === '/api/v1/notifications') {
    return jsonResponse(rules);
  }

  return undefined;
}

function handlePatchRequest(
  request: StoryMockRequest,
  rules: NotificationRuleApiItem[],
): Response | undefined {
  if (!request.path.startsWith('/api/v1/notifications/')) {
    return undefined;
  }

  const id = request.path.replace('/api/v1/notifications/', '');
  const index = rules.findIndex((rule) => rule.id === id);
  if (index < 0) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const body = parsePatchBody(request);
  rules[index] = mergeRuleUpdate(rules[index], body);
  return jsonResponse(rules[index]);
}

function handleMockRequest(
  request: StoryMockRequest,
  rules: NotificationRuleApiItem[],
  triggers: TriggerApiItem[],
): Response | undefined {
  if (request.method === 'GET') {
    return handleGetRequest(request, rules, triggers);
  }
  if (request.method === 'PATCH') {
    return handlePatchRequest(request, rules);
  }
  return undefined;
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
    const request = await parseRequest(input, init);
    return (
      handleMockRequest(request, inMemoryRules, triggers) ??
      jsonResponse({ error: `No mock for ${request.method} ${request.path}` }, 404)
    );
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
