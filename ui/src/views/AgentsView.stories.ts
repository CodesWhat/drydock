import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import AgentsView from './AgentsView.vue';

interface AgentApiItem {
  name: string;
  host: string;
  port?: number;
  connected: boolean;
  dockerVersion?: string;
  os?: string;
  arch?: string;
  cpus?: number;
  memoryGb?: number;
  containers?: { total: number; running: number; stopped: number };
  images?: number;
  lastSeen?: string;
  version?: string;
  uptime?: string;
  logLevel?: string;
  pollInterval?: string;
}

interface AgentLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  msg: string;
}

const agentsFixture: AgentApiItem[] = [
  {
    name: 'edge-1',
    host: '10.0.0.31',
    port: 2376,
    connected: true,
    dockerVersion: '27.0.0',
    os: 'linux',
    arch: 'amd64',
    cpus: 8,
    memoryGb: 16,
    containers: { total: 12, running: 10, stopped: 2 },
    images: 45,
    lastSeen: 'Just now',
    version: '1.4.0',
    uptime: '4d 3h',
    logLevel: 'info',
    pollInterval: '30s',
  },
  {
    name: 'edge-2',
    host: '10.0.0.32',
    port: 2376,
    connected: false,
    dockerVersion: '26.1.0',
    os: 'linux',
    arch: 'arm64',
    cpus: 4,
    memoryGb: 8,
    containers: { total: 5, running: 0, stopped: 5 },
    images: 18,
    lastSeen: 'Never',
    version: '1.3.9',
    uptime: '-',
    logLevel: 'warn',
    pollInterval: '60s',
  },
];

const logFixtureByAgent: Record<string, AgentLogEntry[]> = {
  'edge-1': [
    {
      timestamp: '2026-02-20T10:12:15.111Z',
      level: 'info',
      component: 'watcher',
      msg: 'Polling completed successfully',
    },
    {
      timestamp: '2026-02-20T10:13:15.222Z',
      level: 'warn',
      component: 'registry',
      msg: 'Rate limit nearing threshold',
    },
  ],
  'edge-2': [],
};

function installAgentsMock(data: AgentApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
    const path = url.pathname;

    if (path === '/api/agents') {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const match = path.match(/^\/api\/agents\/([^/]+)\/log\/entries$/);
    if (match) {
      const agent = decodeURIComponent(match[1]);
      const entries = logFixtureByAgent[agent] ?? [];
      return new Response(JSON.stringify(entries), {
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
  component: AgentsView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; min-height: 900px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof AgentsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installAgentsMock(agentsFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('edge-1')).toBeInTheDocument();
    });
    await expect(canvas.getByText('edge-2')).toBeInTheDocument();
  },
};

export const DetailAndLogs: Story = {
  loaders: [
    async () => {
      installAgentsMock(agentsFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('edge-1')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByText('edge-1'));
    await expect(canvas.getByText('Overview')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Logs' }));
    await waitFor(() => {
      expect(canvas.getByText('Polling completed successfully')).toBeInTheDocument();
    });
  },
};

export const CardsAndFilter: Story = {
  loaders: [
    async () => {
      installAgentsMock(agentsFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('edge-2')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('10.0.0.31:2376')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'edge-2');
    await expect(canvas.getByText('edge-2')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      installAgentsMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('No agents match your filters')).toBeInTheDocument();
    });
  },
};
