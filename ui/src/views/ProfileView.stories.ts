import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, waitFor, within } from 'storybook/test';
import ProfileView from './ProfileView.vue';

interface UserApi {
  username?: string | null;
  email?: string | null;
  role?: string | null;
  lastLogin?: string | null;
  sessions?: number | null;
}

function installProfileMock(user: UserApi | undefined) {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = raw.startsWith('http') ? new URL(raw).pathname : raw;

    if (path === '/auth/user') {
      if (!user) {
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify(user), {
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
  component: ProfileView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: '<div style="padding: 1rem; max-width: 880px;"><story /></div>',
    }),
  ],
} satisfies Meta<typeof ProfileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoadedProfile: Story = {
  loaders: [
    async () => {
      installProfileMock({
        username: 'sbenson',
        email: 'sbenson@example.com',
        role: 'admin',
        lastLogin: '2026-02-21 18:42 UTC',
        sessions: 2,
      });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('sbenson')).toBeInTheDocument();
    });
    await expect(canvas.getByText('sbenson@example.com')).toBeInTheDocument();
    await expect(canvas.getByText('Sign Out')).toBeInTheDocument();
  },
};

export const FallbackValues: Story = {
  loaders: [
    async () => {
      installProfileMock({
        username: null,
        email: null,
        role: null,
        lastLogin: null,
        sessions: null,
      });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('unknown')).toBeInTheDocument();
    });
    await expect(canvas.getByText('0')).toBeInTheDocument();
  },
};
