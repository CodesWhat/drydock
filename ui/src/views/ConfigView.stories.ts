import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ConfigView from './ConfigView.vue';

interface ConfigMockOptions {
  internetlessMode?: boolean;
  iconCacheCleared?: number;
}

function installConfigMock(options: ConfigMockOptions = {}) {
  let settings = {
    internetlessMode: options.internetlessMode ?? false,
  };
  const cacheCleared = options.iconCacheCleared ?? 7;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost');
    const path = url.pathname;
    const method =
      init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

    if (path === '/api/server' && method === 'GET') {
      return new Response(
        JSON.stringify({
          configuration: {
            port: 3000,
            feature: { containeractions: true, delete: true },
            webhook: { enabled: true },
            trustproxy: false,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (path === '/api/app' && method === 'GET') {
      return new Response(JSON.stringify({ version: '1.4.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/settings' && method === 'GET') {
      return new Response(JSON.stringify(settings), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/settings' && method === 'PUT') {
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Partial<{
        internetlessMode: boolean;
      }>;
      settings = {
        ...settings,
        ...body,
      };
      return new Response(JSON.stringify(settings), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/icons/cache' && method === 'DELETE') {
      return new Response(JSON.stringify({ cleared: cacheCleared }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `No mock for ${method} ${path}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function resetConfigState() {
  localStorage.removeItem('drydock-theme-family');
  localStorage.removeItem('drydock-theme-variant');
  localStorage.removeItem('drydock-icon-library');
  localStorage.removeItem('drydock-icon-scale');
  localStorage.removeItem('drydock-font-family');
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
