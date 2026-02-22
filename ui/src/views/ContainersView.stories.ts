import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ContainersView from './ContainersView.vue';

interface ContainerApiItem {
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
  labels?: Record<string, string>;
}

const containersFixture: ContainerApiItem[] = [
  {
    id: 'c-api',
    name: 'api',
    displayName: 'drydock-api',
    status: 'running',
    watcher: 'local',
    displayIcon: 'sh-box',
    image: {
      registry: { name: 'ghcr', url: 'https://ghcr.io' },
      name: 'ghcr.io/drydock/api',
      tag: { value: '1.3.7' },
    },
    result: { tag: '1.4.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'minor' },
    security: { scan: { status: 'ok', summary: { critical: 0, high: 0 } } },
    labels: { app: 'drydock-api', owner: 'platform' },
  },
  {
    id: 'c-web',
    name: 'web',
    displayName: 'drydock-web',
    status: 'running',
    agent: 'edge-1',
    displayIcon: 'sh-globe',
    image: {
      registry: { name: 'ghcr', url: 'https://ghcr.io' },
      name: 'ghcr.io/drydock/web',
      tag: { value: '1.3.7' },
    },
    result: { tag: '2.0.0' },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'major' },
    security: { scan: { status: 'blocked', summary: { critical: 1, high: 2 } } },
    labels: { app: 'drydock-web', tier: 'frontend' },
  },
  {
    id: 'c-worker',
    name: 'worker',
    displayName: 'queue-worker',
    status: 'stopped',
    agent: 'edge-1',
    displayIcon: 'sh-gears',
    image: {
      registry: { name: 'dockerhub', url: 'https://docker.io' },
      name: 'redis',
      tag: { value: '7.2.0' },
    },
    result: { tag: '7.2.1' },
    updateAvailable: true,
    updateKind: { kind: 'tag', semverDiff: 'patch' },
    security: { scan: { status: 'ok', summary: { critical: 0, high: 1 } } },
    labels: { app: 'worker' },
  },
  {
    id: 'c-db',
    name: 'postgres',
    displayName: 'postgres',
    status: 'running',
    agent: 'edge-2',
    displayIcon: 'sh-database',
    image: {
      registry: { name: 'dockerhub', url: 'https://docker.io' },
      name: 'postgres',
      tag: { value: '16.1' },
    },
    updateAvailable: false,
    security: { scan: { status: 'ok', summary: { critical: 0, high: 0 } } },
    labels: { app: 'database' },
  },
];

const logsByContainerId: Record<string, string> = {
  'c-api':
    '2026-02-20T10:00:00.000Z [info] API boot complete\n2026-02-20T10:00:05.100Z [info] healthcheck ok',
  'c-web':
    '2026-02-20T10:01:00.000Z [warn] stale cache detected\n2026-02-20T10:01:03.250Z [info] refresh complete',
  'c-worker':
    '2026-02-20T10:02:00.000Z [error] worker crashed\n2026-02-20T10:02:02.000Z [info] restart scheduled',
  'c-db': '2026-02-20T10:03:00.000Z [info] checkpoint completed',
};

function installContainersMock(data: ContainerApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
    const path = url.pathname;

    if (path === '/api/containers') {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const logsMatch = path.match(/^\/api\/containers\/([^/]+)\/logs$/);
    if (logsMatch) {
      const containerId = decodeURIComponent(logsMatch[1]);
      return new Response(
        JSON.stringify({
          logs: logsByContainerId[containerId] ?? 'No logs available',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify({ error: `No mock for ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function resetContainerViewState() {
  localStorage.setItem('dd-table-actions', 'icons');
  sessionStorage.removeItem('dd-panel');
}

const meta = {
  component: ContainersView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; min-height: 920px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof ContainersView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      resetContainerViewState();
      installContainersMock(containersFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('drydock-api')).toBeInTheDocument();
    });
    await expect(canvas.getByText('queue-worker')).toBeInTheDocument();
  },
};

export const DetailAndLogs: Story = {
  loaders: [
    async () => {
      resetContainerViewState();
      installContainersMock(containersFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('drydock-web')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByText('drydock-web'));
    await expect(canvas.getByText('Overview')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Logs' }));
    await waitFor(() => {
      expect(canvas.getByText(/stale cache detected/i)).toBeInTheDocument();
    });
  },
};

export const CardsAndFilter: Story = {
  loaders: [
    async () => {
      resetContainerViewState();
      installContainersMock(containersFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('postgres')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('drydock-web')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.selectOptions(canvas.getByDisplayValue('Update'), 'major');
    await expect(canvas.getByText('drydock-web')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      resetContainerViewState();
      installContainersMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('No containers match your filters')).toBeInTheDocument();
    });
  },
};
