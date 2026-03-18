import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RegistriesView from './RegistriesView.vue';
import { installJsonPathMock } from './storybookFetchMock';

interface RegistryApiItem {
  id: string;
  name: string;
  type: string;
  configuration?: Record<string, string>;
}

function createRegistryFixture(
  id: string,
  name: string,
  type: string,
  configuration?: Record<string, string>,
): RegistryApiItem {
  return { id, name, type, configuration };
}

const registryFixture: RegistryApiItem[] = [
  createRegistryFixture('reg-hub', 'Docker Hub', 'hub', {
    url: 'https://registry-1.docker.io',
    namespace: 'library',
  }),
  createRegistryFixture('reg-ghcr', 'GitHub Container Registry', 'ghcr', {
    url: 'https://ghcr.io',
    org: 'drydock',
  }),
  createRegistryFixture('reg-ecr', 'AWS ECR', 'ecr', {
    url: 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com',
    region: 'us-east-1',
  }),
];

function installRegistriesMock(data: RegistryApiItem[]) {
  installJsonPathMock('/api/v1/registries', data);
}

function registriesLoader(data: RegistryApiItem[]) {
  return async () => {
    installRegistriesMock(data);
    return {};
  };
}

function createStory(data: RegistryApiItem[], play: NonNullable<Story['play']>): Story {
  return {
    loaders: [registriesLoader(data)],
    play,
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

export const DefaultTable: Story = createStory(registryFixture, async ({ canvasElement }) => {
  const canvas = within(canvasElement);

  await waitFor(() => {
    expect(canvas.getByText('Docker Hub')).toBeInTheDocument();
  });
  await expect(canvas.getByText('AWS ECR')).toBeInTheDocument();
});

export const CardsAndFilter: Story = createStory(registryFixture, async ({ canvasElement }) => {
  const canvas = within(canvasElement);

  await waitFor(() => {
    expect(canvas.getByText('GitHub Container Registry')).toBeInTheDocument();
  });

  await userEvent.click(canvas.getByTitle('Cards view'));
  await expect(canvas.getByText('AWS ECR')).toBeInTheDocument();

  await userEvent.click(canvas.getByTitle('Filters'));
  await userEvent.type(canvas.getByPlaceholderText('Filter by name...'), 'docker');
  await expect(canvas.getByText('Docker Hub')).toBeInTheDocument();
});

export const ListMode: Story = createStory(registryFixture, async ({ canvasElement }) => {
  const canvas = within(canvasElement);

  await waitFor(() => {
    expect(canvas.getByText('AWS ECR')).toBeInTheDocument();
  });

  await userEvent.click(canvas.getByTitle('List view'));
  await userEvent.click(canvas.getByText('AWS ECR'));
  await expect(canvas.getByText('region')).toBeInTheDocument();
});

export const Empty: Story = createStory([], async ({ canvasElement }) => {
  const canvas = within(canvasElement);

  await waitFor(() => {
    expect(canvas.getByText('No registries match your filters')).toBeInTheDocument();
  });
});
