/**
 * Shared mount helper for component tests.
 *
 * Provides directive stubs, router mock, and common provide values
 * so individual test files don't need to repeat boilerplate.
 */
import { type ComponentMountingOptions, mount as vtuMount } from '@vue/test-utils';
import { type Component, defineComponent, h } from 'vue';

/** Minimal plugin stub — registers directive stubs only. */
const DirectiveStub = {
  install(app: any) {
    // Stub v-tooltip directive
    app.directive('tooltip', {});
  },
};

/** Stub router for provide injection. */
const routerStub = {
  push: vi.fn(),
  replace: vi.fn(),
  go: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  currentRoute: { value: { name: 'test', path: '/test', query: {}, params: {} } },
};

const routeStub = { name: 'test', path: '/test', query: {}, params: {} };

/** Stub for useConfirm() — returns a confirm with require as vi.fn() */
const confirmStub = { require: vi.fn() };

/**
 * Mount a component with directive + router stubs pre-configured.
 * Accepts all @vue/test-utils mount options.
 */
export function mountWithPlugins<T extends Component>(
  component: T,
  options: ComponentMountingOptions<T> = {},
) {
  const { global: globalOpts = {}, ...rest } = options as any;
  const { plugins = [], provide = {}, stubs = {}, ...globalRest } = globalOpts;

  return vtuMount(component, {
    ...rest,
    global: {
      plugins: [DirectiveStub, ...plugins],
      provide: {
        // Vue Router symbols
        'Symbol(route location)': routeStub,
        'Symbol(router)': routerStub,
        ...provide,
      },
      stubs: {
        // Stub global components
        ConfirmDialog: defineComponent({ render: () => h('div') }),
        AppIcon: defineComponent({
          props: ['name', 'size'],
          template: '<span class="app-icon-stub" :data-icon="name" :data-size="size" />',
        }),
        ContainerIcon: defineComponent({
          props: ['icon', 'size'],
          template: '<span class="container-icon-stub" :data-icon="icon" />',
        }),
        ...stubs,
      },
      ...globalRest,
    },
  });
}

export { routerStub, routeStub, confirmStub };
