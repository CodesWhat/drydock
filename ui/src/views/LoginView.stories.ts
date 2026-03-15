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

const JSON_HEADERS = { 'Content-Type': 'application/json' };

type LoginMockRequestContext = {
  path: string;
  method: string;
  init?: RequestInit;
  options: LoginMockOptions;
};

function createJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function getLoginMockRequestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  const method =
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

  return { path: url.pathname, method };
}

function parseJsonBody<T>(init?: RequestInit): T {
  return (init?.body ? JSON.parse(String(init.body)) : {}) as T;
}

function handleStrategiesRequest(context: LoginMockRequestContext): Response | undefined {
  if (context.path !== '/api/v1/auth/status' || context.method !== 'GET') {
    return undefined;
  }

  return createJsonResponse({ providers: context.options.strategies, errors: [] }, 200);
}

function handleLoginRequest(context: LoginMockRequestContext): Response | undefined {
  if (context.path !== '/auth/login' || context.method !== 'POST') {
    return undefined;
  }

  const payload = parseJsonBody<LoginPayload>(context.init);
  loginPayloads.push(payload);

  if (context.options.allowBasicLogin === false) {
    return createJsonResponse({ error: 'Unauthorized' }, 401);
  }

  return createJsonResponse(
    {
      username: payload.username ?? 'unknown',
      role: 'admin',
    },
    200,
  );
}

function handleRememberRequest(context: LoginMockRequestContext): Response | undefined {
  if (context.path !== '/auth/remember' || context.method !== 'POST') {
    return undefined;
  }

  const payload = parseJsonBody<{ remember?: boolean }>(context.init);
  rememberPayloads.push(payload);

  return createJsonResponse({ ok: true }, 200);
}

function handleOidcRedirectRequest(context: LoginMockRequestContext): Response | undefined {
  const isOidcRedirectRequest =
    context.path.startsWith('/auth/oidc/') &&
    context.path.endsWith('/redirect') &&
    context.method === 'GET';

  if (!isOidcRedirectRequest) {
    return undefined;
  }

  return createJsonResponse(
    {
      redirect: context.options.oidcRedirectUrl ?? 'https://example.com/oidc/redirect',
    },
    200,
  );
}

function routeLoginMockRequest(context: LoginMockRequestContext): Response {
  const handlers = [
    handleStrategiesRequest,
    handleLoginRequest,
    handleRememberRequest,
    handleOidcRedirectRequest,
  ];

  for (const handler of handlers) {
    const response = handler(context);
    if (response) {
      return response;
    }
  }

  return createJsonResponse({ error: `No mock for ${context.method} ${context.path}` }, 404);
}

function installLoginMock(options: LoginMockOptions) {
  loginPayloads = [];
  rememberPayloads = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestDetails = getLoginMockRequestDetails(input, init);
    return routeLoginMockRequest({ ...requestDetails, init, options });
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
