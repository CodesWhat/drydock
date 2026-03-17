import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import WatchersView from './WatchersView.vue';

interface StoryMockRequest {
  method: string;
  path: string;
}

interface WatcherApiItem {
  id: string;
  name: string;
  type: string;
  configuration: {
    cron: string;
    maintenanceWindow?: string;
  };
}

const watcherFixtures: WatcherApiItem[] = [
  {
    id: 'w-local',
    name: 'Local Docker',
    type: 'docker',
    configuration: { cron: '0 */6 * * *' },
  },
  {
    id: 'w-edge-1',
    name: 'Edge Cluster 1',
    type: 'docker',
    configuration: { cron: '*/30 * * * *', maintenanceWindow: 'Sun 02:00-03:00 UTC' },
  },
  {
    id: 'w-edge-2',
    name: 'Edge Cluster 2',
    type: 'docker',
    configuration: { cron: '15 * * * *' },
  },
];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

function parseStoryRequest(input: RequestInfo | URL, init?: RequestInit): StoryMockRequest {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return { method, path: url.pathname };
}

function installWatchersMock(data: WatcherApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = parseStoryRequest(input, init);

    if (request.method === 'GET' && request.path === '/api/watchers') {
      return createJsonResponse(data);
    }

    return createJsonResponse({ error: `No mock for ${request.method} ${request.path}` }, 404);
  };
}

const meta = {
  component: WatchersView,
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
} satisfies Meta<typeof WatchersView>;

export default meta;
type Story = StoryObj<typeof meta>;
type StoryCanvas = ReturnType<typeof within>;
type StoryLoader = () => Promise<Record<string, never>>;

function createWatchersLoader(data: WatcherApiItem[]): StoryLoader {
  return async () => {
    installWatchersMock(data);
    return {};
  };
}

function createWatchersStory(data: WatcherApiItem[], play: NonNullable<Story['play']>): Story {
  return {
    loaders: [createWatchersLoader(data)],
    play,
  };
}

async function expectTextVisible(canvas: StoryCanvas, text: string): Promise<void> {
  await waitFor(() => {
    expect(canvas.getByText(text)).toBeInTheDocument();
  });
}

export const DefaultTable: Story = createWatchersStory(
  watcherFixtures,
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectTextVisible(canvas, 'Local Docker');
    await expect(canvas.getByText('Edge Cluster 1')).toBeInTheDocument();
  },
);

export const ViewModeAndFilter: Story = createWatchersStory(
  watcherFixtures,
  async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expectTextVisible(canvas, 'Local Docker');

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('Edge Cluster 2')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'edge cluster 1');
    await expect(canvas.getByText('Edge Cluster 1')).toBeInTheDocument();
  },
);

export const Empty: Story = createWatchersStory([], async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expectTextVisible(canvas, 'No watchers match your filters');
});
