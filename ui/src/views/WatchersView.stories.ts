import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import WatchersView from './WatchersView.vue';

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

function installWatchersMock(data: WatcherApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/watchers') {
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

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installWatchersMock(watcherFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Local Docker')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Edge Cluster 1')).toBeInTheDocument();
  },
};

export const ViewModeAndFilter: Story = {
  loaders: [
    async () => {
      installWatchersMock(watcherFixtures);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Local Docker')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('Edge Cluster 2')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'edge cluster 1');
    await expect(canvas.getByText('Edge Cluster 1')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      installWatchersMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('No watchers match your filters')).toBeInTheDocument();
    });
  },
};
