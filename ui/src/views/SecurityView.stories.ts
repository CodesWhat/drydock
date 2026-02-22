import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import SecurityView from './SecurityView.vue';

interface VulnerabilityApi {
  id: string;
  severity: string;
  packageName: string;
  installedVersion: string;
  fixedVersion?: string | null;
  publishedDate?: string;
}

interface SecurityContainerApi {
  id: string;
  name: string;
  displayName?: string;
  security?: {
    scan?: {
      vulnerabilities?: VulnerabilityApi[];
    };
  };
}

const securityContainersFixture: SecurityContainerApi[] = [
  {
    id: 'sec-api',
    name: 'api',
    displayName: 'drydock-api',
    security: {
      scan: {
        vulnerabilities: [
          {
            id: 'CVE-2025-1000',
            severity: 'CRITICAL',
            packageName: 'openssl',
            installedVersion: '3.0.1',
            fixedVersion: '3.0.16',
            publishedDate: '2025-01-10',
          },
          {
            id: 'CVE-2024-2222',
            severity: 'HIGH',
            packageName: 'glibc',
            installedVersion: '2.34',
            fixedVersion: null,
            publishedDate: '2024-12-02',
          },
        ],
      },
    },
  },
  {
    id: 'sec-web',
    name: 'web',
    displayName: 'drydock-web',
    security: {
      scan: {
        vulnerabilities: [
          {
            id: 'CVE-2023-5555',
            severity: 'MEDIUM',
            packageName: 'zlib',
            installedVersion: '1.2.11',
            fixedVersion: '1.3.0',
            publishedDate: '2023-11-18',
          },
        ],
      },
    },
  },
];

function installSecurityMock(data: SecurityContainerApi[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/containers') {
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
  component: SecurityView,
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
} satisfies Meta<typeof SecurityView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installSecurityMock(securityContainersFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('CVE-2025-1000')).toBeInTheDocument();
    });
    await expect(canvas.getByText('CRITICAL')).toBeInTheDocument();
  },
};

export const FiltersAndCards: Story = {
  loaders: [
    async () => {
      installSecurityMock(securityContainersFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('CVE-2024-2222')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.selectOptions(canvas.getByDisplayValue('Severity'), 'HIGH');
    await expect(canvas.getByText('CVE-2024-2222')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('No fix available')).toBeInTheDocument();
  },
};

export const ListView: Story = {
  loaders: [
    async () => {
      installSecurityMock(securityContainersFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('CVE-2023-5555')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('List view'));
    await userEvent.click(canvas.getByText('CVE-2023-5555'));
    await expect(canvas.getByText('Package')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      installSecurityMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => {
      expect(canvas.getByText('No vulnerabilities match your filters')).toBeInTheDocument();
    });
  },
};
