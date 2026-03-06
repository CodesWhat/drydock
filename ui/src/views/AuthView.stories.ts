import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import AuthView from './AuthView.vue';

interface AuthenticationApiItem {
  id: string;
  name: string;
  type: string;
  configuration?: Record<string, string>;
}

const authFixture: AuthenticationApiItem[] = [
  {
    id: 'auth-basic',
    name: 'Local Basic',
    type: 'basic',
    configuration: {
      users: 'local',
      sessionTtl: '24h',
    },
  },
  {
    id: 'auth-github',
    name: 'GitHub OIDC',
    type: 'oidc',
    configuration: {
      issuer: 'https://token.actions.githubusercontent.com',
      clientId: 'drydock-web',
    },
  },
  {
    id: 'auth-anon',
    name: 'Anonymous',
    type: 'anonymous',
    configuration: {
      role: 'viewer',
    },
  },
];

function installAuthMock(data: AuthenticationApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/authentications') {
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
  component: AuthView,
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
} satisfies Meta<typeof AuthView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installAuthMock(authFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Local Basic')).toBeInTheDocument();
    });
    await expect(canvas.getByText('GitHub OIDC')).toBeInTheDocument();
  },
};

export const CardsAndFilter: Story = {
  loaders: [
    async () => {
      installAuthMock(authFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Anonymous')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('GitHub OIDC')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'local');
    await expect(canvas.getByText('Local Basic')).toBeInTheDocument();
  },
};

export const ListMode: Story = {
  loaders: [
    async () => {
      installAuthMock(authFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('GitHub OIDC')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('List view'));
    await userEvent.click(canvas.getByText('GitHub OIDC'));
    await expect(canvas.getByText('clientId')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      installAuthMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('No providers match your filters')).toBeInTheDocument();
    });
  },
};
