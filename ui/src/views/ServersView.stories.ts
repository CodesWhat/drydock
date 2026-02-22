import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ServersView from './ServersView.vue';

interface AgentApiItem {
  name: string;
  connected: boolean;
  host: string;
  port?: number;
}

interface ContainerApiItem {
  id: string;
  watcher?: string;
  status: 'running' | 'stopped';
}

const agentsFixture: AgentApiItem[] = [
  { name: 'Edge-1', connected: true, host: '10.0.0.21', port: 2376 },
  { name: 'Edge-2', connected: false, host: '10.0.0.22', port: 2376 },
];

const containersFixture: ContainerApiItem[] = [
  { id: 'c-1', watcher: 'local', status: 'running' },
  { id: 'c-2', watcher: 'local', status: 'running' },
  { id: 'c-3', watcher: 'local', status: 'stopped' },
  { id: 'c-4', watcher: 'edge-1', status: 'running' },
  { id: 'c-5', watcher: 'edge-1', status: 'stopped' },
];

function installServersMock() {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/server') {
      return new Response(JSON.stringify({ name: 'drydock', version: '1.4.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/api/agents') {
      return new Response(JSON.stringify(agentsFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (path === '/api/containers') {
      return new Response(JSON.stringify(containersFixture), {
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
  component: ServersView,
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
} satisfies Meta<typeof ServersView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installServersMock();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Local')).toBeInTheDocument();
    });
    await expect(canvas.getByText('Edge-1')).toBeInTheDocument();
  },
};

export const OpenDetailPanel: Story = {
  loaders: [
    async () => {
      installServersMock();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Edge-1')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByText('Edge-1'));
    await expect(canvas.getByText('Containers')).toBeInTheDocument();
    await expect(canvas.getByText('Refresh')).toBeInTheDocument();
  },
};

export const CardsAndFilter: Story = {
  loaders: [
    async () => {
      installServersMock();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('Edge-2')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('Edge-1')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name or address...'), 'edge-2');
    await expect(canvas.getByText('Edge-2')).toBeInTheDocument();
  },
};

