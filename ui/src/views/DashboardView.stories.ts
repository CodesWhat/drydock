import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import DashboardView from './DashboardView.vue';

interface DashboardContainerApi {
  id: string;
  name: string;
  displayName?: string;
  status: 'running' | 'stopped';
  watcher?: string;
  agent?: string;
  displayIcon?: string;
  image: {
    registry: { name: string; url: string };
    name: string;
    tag: { value: string };
  };
  result?: { tag?: string };
  updateAvailable?: boolean;
  updateKind?: { kind?: string; semverDiff?: string };
  security?: {
    scan?: {
      status?: string;
      summary?: { critical?: number; high?: number };
    };
  };
}

const containersFixture: DashboardContainerApi[] = [
  {
    id: 'c-api',
    name: 'api',
    displayName: 'drydock-api',
    status: 'running',
    watcher: 'local',
    displayIcon: 'fa-solid fa-box',
    image: {
      registry: { name: 'ghcr', url: 'https://ghcr.io' },
      name: 'ghcr.io/drydock/api',
      tag: { value: '1.3.7' },
    },
    result: { tag: '1.4.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'minor' },
    security: { scan: { status: 'ok', summary: { critical: 0, high: 0 } } },
  },
  {
    id: 'c-web',
    name: 'web',
    displayName: 'drydock-web',
    status: 'running',
    watcher: 'local',
    displayIcon: 'fa-solid fa-globe',
    image: {
      registry: { name: 'ghcr', url: 'https://ghcr.io' },
      name: 'ghcr.io/drydock/web',
      tag: { value: '1.3.7' },
    },
    result: { tag: '2.0.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
    security: { scan: { status: 'blocked', summary: { critical: 1, high: 2 } } },
  },
  {
    id: 'c-worker',
    name: 'worker',
    displayName: 'queue-worker',
    status: 'running',
    agent: 'edge-1',
    displayIcon: 'fa-solid fa-gears',
    image: {
      registry: { name: 'dockerhub', url: 'https://docker.io' },
      name: 'redis',
      tag: { value: '7.2.0' },
    },
    result: { tag: '7.2.1' },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'patch' },
    security: { scan: { status: 'ok', summary: { critical: 0, high: 1 } } },
  },
  {
    id: 'c-db',
    name: 'postgres',
    displayName: 'postgres',
    status: 'stopped',
    agent: 'edge-2',
    displayIcon: 'fa-solid fa-database',
    image: {
      registry: { name: 'dockerhub', url: 'https://docker.io' },
      name: 'postgres',
      tag: { value: '16.1' },
    },
    updateAvailable: false,
    security: { scan: { status: 'ok', summary: { critical: 0, high: 0 } } },
  },
];

const agentsFixture = [
  { name: 'edge-1', connected: true, host: '10.0.0.11', port: 2376 },
  { name: 'edge-2', connected: false, host: '10.0.0.12', port: 2376 },
];

function installDashboardMock() {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/containers') {
      return new Response(JSON.stringify(containersFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

    return new Response(JSON.stringify({ error: `No mock for ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const meta = {
  component: DashboardView,
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
} satisfies Meta<typeof DashboardView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  loaders: [
    async () => {
      installDashboardMock();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Security Overview')).toBeInTheDocument();
    });

    await expect(canvas.getByText('Host Status')).toBeInTheDocument();
    await expect(canvas.getByText('Top Vulnerabilities')).toBeInTheDocument();
    await expect(canvas.getByText('drydock-web')).toBeInTheDocument();
  },
};

export const NavigationActions: Story = {
  loaders: [
    async () => {
      installDashboardMock();
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Pending Updates')).toBeInTheDocument();
    });

    const viewAllButtons = canvas.getAllByRole('button', { name: /View all/i });
    await userEvent.click(viewAllButtons[0]);
    await expect(canvas.getByText('Pending Updates')).toBeInTheDocument();
  },
};

