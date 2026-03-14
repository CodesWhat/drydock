import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ConfigView from './ConfigView.vue';

interface ConfigMockOptions {
  internetlessMode?: boolean;
  iconCacheCleared?: number;
}

interface ConfigMockState {
  settings: {
    internetlessMode: boolean;
  };
  cacheCleared: number;
}

interface MockRequestDetails {
  path: string;
  method: string;
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getMockRequestDetails(input: RequestInfo | URL, init?: RequestInit): MockRequestDetails {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
  const method =
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  return {
    path: url.pathname,
    method,
  };
}

function parseSettingsUpdateBody(body: BodyInit | null | undefined): Partial<{
  internetlessMode: boolean;
}> {
  return body ? (JSON.parse(String(body)) as Partial<{ internetlessMode: boolean }>) : {};
}

function handleConfigMockRequest(
  state: ConfigMockState,
  request: MockRequestDetails,
  init?: RequestInit,
): Response | undefined {
  if (request.path === '/api/server' && request.method === 'GET') {
    return createJsonResponse({
      configuration: {
        port: 3000,
        feature: { containeractions: true, delete: true },
        webhook: { enabled: true },
        trustproxy: false,
      },
    });
  }

  if (request.path === '/api/app' && request.method === 'GET') {
    return createJsonResponse({ version: '1.4.0' });
  }

  if (request.path === '/api/settings' && request.method === 'GET') {
    return createJsonResponse(state.settings);
  }

  if (
    request.path === '/api/settings' &&
    (request.method === 'PATCH' || request.method === 'PUT')
  ) {
    state.settings = {
      ...state.settings,
      ...parseSettingsUpdateBody(init?.body),
    };
    return createJsonResponse(state.settings);
  }

  if (request.path === '/api/icons/cache' && request.method === 'DELETE') {
    return createJsonResponse({ cleared: state.cacheCleared });
  }

  return undefined;
}

function installConfigMock(options: ConfigMockOptions = {}) {
  const state: ConfigMockState = {
    settings: {
      internetlessMode: options.internetlessMode ?? false,
    },
    cacheCleared: options.iconCacheCleared ?? 7,
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = getMockRequestDetails(input, init);
    return (
      handleConfigMockRequest(state, request, init) ??
      createJsonResponse({ error: `No mock for ${request.method} ${request.path}` }, 404)
    );
  };
}

function resetConfigState() {
  localStorage.removeItem('dd-preferences');
  document.documentElement.classList.remove('theme-github', 'theme-dracula', 'theme-catppuccin');
}

const meta = {
  component: ConfigView,
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
} satisfies Meta<typeof ConfigView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GeneralTabLoaded: Story = {
  loaders: [
    async () => {
      resetConfigState();
      installConfigMock({ internetlessMode: false, iconCacheCleared: 7 });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Application')).toBeInTheDocument();
    });
    await expect(canvas.getByText('1.4.0')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: 'Clear Cache' }));
    await waitFor(() => {
      expect(canvas.getByText('7 cleared')).toBeInTheDocument();
    });
  },
};

export const AppearanceTab: Story = {
  loaders: [
    async () => {
      resetConfigState();
      installConfigMock({ internetlessMode: true });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    });

    await userEvent.click(canvas.getByRole('button', { name: 'Appearance' }));
    await expect(canvas.getByText('Color Theme')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: /GitHub/ }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains('theme-github')).toBe(true);
    });
  },
};

export const ToggleInternetlessMode: Story = {
  loaders: [
    async () => {
      resetConfigState();
      installConfigMock({ internetlessMode: false });
      return {};
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getByText('Internetless Mode')).toBeInTheDocument();
    });

    const getToggleButton = () => {
      const row = canvas.getByText('Internetless Mode').closest('div')?.parentElement;
      return row?.querySelector('button') as HTMLButtonElement | null;
    };

    const toggleButton = getToggleButton();
    expect(toggleButton).not.toBeNull();

    await userEvent.click(toggleButton as HTMLButtonElement);

    await waitFor(() => {
      const thumb = getToggleButton()?.querySelector('span');
      expect(thumb).not.toBeNull();
      expect(thumb?.className).toContain('translate-x-5');
    });
  },
};
