import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RegistriesView from './RegistriesView.vue';

interface RegistryApiItem {
  id: string;
  name: string;
  type: string;
  configuration?: Record<string, string>;
}

const registryFixture: RegistryApiItem[] = [
  {
    id: 'reg-hub',
    name: 'Docker Hub',
    type: 'hub',
    configuration: {
      url: 'https://registry-1.docker.io',
      namespace: 'library',
    },
  },
  {
    id: 'reg-ghcr',
    name: 'GitHub Container Registry',
    type: 'ghcr',
    configuration: {
      url: 'https://ghcr.io',
      org: 'drydock',
    },
  },
  {
    id: 'reg-ecr',
    name: 'AWS ECR',
    type: 'ecr',
    configuration: {
      url: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com',
      region: 'us-east-1',
    },
  },
];

function installRegistriesMock(data: RegistryApiItem[]) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/api/registries') {
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
  component: RegistriesView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; min-height: 840px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof RegistriesView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTable: Story = {
  loaders: [
    async () => {
      installRegistriesMock(registryFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Docker Hub')).toBeInTheDocument();
    });
    await expect(canvas.getByText('AWS ECR')).toBeInTheDocument();
  },
};

export const CardsAndFilter: Story = {
  loaders: [
    async () => {
      installRegistriesMock(registryFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('GitHub Container Registry')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('Cards view'));
    await expect(canvas.getByText('AWS ECR')).toBeInTheDocument();

    await userEvent.click(canvas.getByTitle('Filters'));
    await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'docker');
    await expect(canvas.getByText('Docker Hub')).toBeInTheDocument();
  },
};

export const ListMode: Story = {
  loaders: [
    async () => {
      installRegistriesMock(registryFixture);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('AWS ECR')).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByTitle('List view'));
    await userEvent.click(canvas.getByText('AWS ECR'));
    await expect(canvas.getByText('region')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  loaders: [
    async () => {
      installRegistriesMock([]);
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('No registries match your filters')).toBeInTheDocument();
    });
  },
};
