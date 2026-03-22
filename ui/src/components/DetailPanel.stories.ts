import type { Meta, StoryObj } from '@storybook/vue3';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ref, watch } from 'vue';
import DetailPanel from './DetailPanel.vue';

const meta = {
  component: DetailPanel,
  tags: ['autodocs'],
  args: {
    'onUpdate:open': fn(),
    'onUpdate:size': fn(),
    onFullPage: fn(),
  },
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (story) => ({
      components: { story },
      template: `
        <div style="height: 780px; padding: 1rem; background: var(--dd-bg); position: relative;">
          <story />
        </div>
      `,
    }),
  ],
} satisfies Meta<typeof DetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;
type PanelSize = 'sm' | 'md' | 'lg';

interface DetailPanelStoryArgs {
  open?: boolean;
  isMobile?: boolean;
  size?: PanelSize;
  showSizeControls?: boolean;
  showFullPage?: boolean;
  'onUpdate:open'?: (value: boolean) => void;
  'onUpdate:size'?: (value: PanelSize) => void;
  onFullPage?: () => void;
}

const renderPanel = (args: Story['args']) => ({
  components: { DetailPanel },
  setup() {
    const storyArgs = (args ?? {}) as DetailPanelStoryArgs;
    const open = ref(!!storyArgs.open);
    const size = ref((storyArgs.size ?? 'sm') as PanelSize);

    watch(
      () => storyArgs.open,
      (value) => {
        open.value = !!value;
      },
    );
    watch(
      () => storyArgs.size,
      (value) => {
        size.value = (value ?? 'sm') as PanelSize;
      },
    );

    return { args: storyArgs, open, size };
  },
  template: `
    <div class="h-full flex">
      <div class="flex-1 dd-rounded"
           :style="{ border: '1px dashed var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-inset)' }" />
      <DetailPanel
        :open="open"
        :is-mobile="args?.isMobile ?? false"
        :size="size"
        :show-size-controls="args?.showSizeControls ?? true"
        :show-full-page="args?.showFullPage ?? false"
        @update:open="(value) => { open = value; args['onUpdate:open']?.(value); }"
        @update:size="(value) => { size = value; args['onUpdate:size']?.(value); }"
        @full-page="args.onFullPage?.()"
      >
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold dd-text">Container Details</h3>
            <span class="badge text-3xs uppercase font-bold"
                  :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
              running
            </span>
          </div>
        </template>
        <template #subtitle>
          <span class="text-2xs-plus font-mono dd-text-secondary">drydock-api</span>
          <span class="text-2xs dd-text-muted">edge-1</span>
        </template>
        <template #tabs>
          <div class="px-4 py-2.5 flex items-center gap-2"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <button class="px-2 py-1 text-2xs dd-rounded dd-bg-elevated dd-text">Overview</button>
            <button class="px-2 py-1 text-2xs dd-rounded dd-text-muted">Logs</button>
            <button class="px-2 py-1 text-2xs dd-rounded dd-text-muted">History</button>
          </div>
        </template>
        <div class="p-4 space-y-3">
          <div class="dd-rounded p-3"
               :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }">
            <div class="text-2xs uppercase tracking-wider font-semibold mb-1 dd-text-muted">Image</div>
            <div class="text-xs font-mono dd-text">ghcr.io/drydock/app:1.3.7</div>
          </div>
          <div class="dd-rounded p-3"
               :style="{ backgroundColor: 'var(--dd-bg-inset)', border: '1px solid var(--dd-border-strong)' }">
            <div class="text-2xs uppercase tracking-wider font-semibold mb-1 dd-text-muted">Uptime</div>
            <div class="text-xs dd-text">4d 12h</div>
          </div>
        </div>
      </DetailPanel>
    </div>
  `,
});

export const DesktopSmall: Story = {
  args: {
    open: true,
    isMobile: false,
    size: 'sm',
    showSizeControls: true,
    showFullPage: true,
    'onUpdate:open': fn(),
    'onUpdate:size': fn(),
    onFullPage: fn(),
  },
  render: renderPanel,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const listeners = args as Record<string, unknown>;

    await userEvent.click(canvas.getByRole('button', { name: 'M' }));
    await expect(listeners['onUpdate:size']).toHaveBeenCalledWith('md');

    await userEvent.click(canvas.getByTitle('Open full page view'));
    await expect(listeners.onFullPage).toHaveBeenCalled();
  },
};

export const DesktopLarge: Story = {
  args: {
    open: true,
    isMobile: false,
    size: 'lg',
    showSizeControls: true,
    showFullPage: false,
  },
  render: renderPanel,
};

export const MobileOverlay: Story = {
  args: {
    open: true,
    isMobile: true,
    size: 'md',
    showSizeControls: false,
    showFullPage: false,
  },
  render: renderPanel,
};

export const Closed: Story = {
  args: {
    open: false,
    isMobile: false,
    size: 'md',
    showSizeControls: true,
    showFullPage: false,
  },
  render: renderPanel,
};
