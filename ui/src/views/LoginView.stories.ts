import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import LoginView from './LoginView.vue';

interface AuthStrategy {
  type: string;
  name: string;
  redirect?: boolean;
}

interface LoginMockOptions {
  strategies: AuthStrategy[];
  allowBasicLogin?: boolean;
  oidcRedirectUrl?: string;
}

interface LoginPayload {
  username?: string;
  password?: string;
  remember?: boolean;
}

let loginPayloads: LoginPayload[] = [];
let rememberPayloads: Array<{ remember?: boolean }> = [];

function installLoginMock(options: LoginMockOptions) {
  loginPayloads = [];
  rememberPayloads = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
    const path = url.pathname;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

    if (path === '/auth/strategies' && method === 'GET') {
      return new Response(JSON.stringify(options.strategies), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/auth/login' && method === 'POST') {
      const payload = (init?.body ? JSON.parse(String(init.body)) : {}) as LoginPayload;
      loginPayloads.push(payload);

      if (options.allowBasicLogin === false) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          username: payload.username ?? 'unknown',
          role: 'admin',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (path === '/auth/remember' && method === 'POST') {
      const payload = (init?.body
        ? JSON.parse(String(init.body))
        : {}) as {
        remember?: boolean;
      };
      rememberPayloads.push(payload);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path.startsWith('/auth/oidc/') && path.endsWith('/redirect') && method === 'GET') {
      return new Response(
        JSON.stringify({
          redirect: options.oidcRedirectUrl ?? 'https://example.com/oidc/redirect',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify({ error: `No mock for ${method} ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const meta = {
  component: LoginView,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof LoginView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BasicAndOidc: Story = {
  loaders: [
    async () => {
      installLoginMock({
        strategies: [
          { type: 'basic', name: 'Basic' },
          { type: 'oidc', name: 'GitHub' },
        ],
      });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Sign in to Drydock')).toBeInTheDocument();
    });

    await userEvent.type(canvas.getByPlaceholderText('Enter your username'), 'sbenson');
    await userEvent.type(canvas.getByPlaceholderText('Enter your password'), 'supersecret');
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Remember me' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(loginPayloads).toHaveLength(1);
    });

    await expect(loginPayloads[0]?.username).toBe('sbenson');
    await expect(loginPayloads[0]?.remember).toBe(true);
    await expect(canvas.queryByText('Invalid username or password')).not.toBeInTheDocument();
  },
};

export const InvalidCredentials: Story = {
  loaders: [
    async () => {
      installLoginMock({
        strategies: [{ type: 'basic', name: 'Basic' }],
        allowBasicLogin: false,
      });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Sign in to Drydock')).toBeInTheDocument();
    });

    await userEvent.type(canvas.getByPlaceholderText('Enter your username'), 'bad-user');
    await userEvent.type(canvas.getByPlaceholderText('Enter your password'), 'bad-pass');
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(canvas.getByText('Invalid username or password')).toBeInTheDocument();
    });
  },
};

export const OidcOnly: Story = {
  loaders: [
    async () => {
      installLoginMock({
        strategies: [
          { type: 'oidc', name: 'GitHub' },
          { type: 'oidc', name: 'GitLab' },
        ],
      });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
    });

    await expect(canvas.getByRole('button', { name: 'GitLab' })).toBeInTheDocument();
    await expect(canvas.queryByPlaceholderText('Enter your username')).not.toBeInTheDocument();
    await expect(canvas.getByRole('checkbox', { name: 'Remember me' })).toBeInTheDocument();
  },
};

export const NoStrategiesConfigured: Story = {
  loaders: [
    async () => {
      installLoginMock({
        strategies: [],
      });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('No authentication methods configured.')).toBeInTheDocument();
    });
  },
};
