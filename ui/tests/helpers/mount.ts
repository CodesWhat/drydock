/**
 * Shared mount helper for component tests.
 *
 * Provides directive stubs, router mock, and common provide values
 * so individual test files don't need to repeat boilerplate.
 */
import { type ComponentMountingOptions, mount as vtuMount } from '@vue/test-utils';
import { type Component, defineComponent, h } from 'vue';
import { tooltip as tooltipDirective } from '@/directives/tooltip';

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

/**
 * Mount a component with directive + router stubs pre-configured.
 * Accepts all @vue/test-utils mount options.
 */
export function mountWithPlugins<T extends Component>(
  component: T,
  options: ComponentMountingOptions<T> = {},
) {
  const { global: globalOpts = {}, ...rest } = options as any;
  const { plugins = [], provide = {}, stubs = {}, directives = {}, ...globalRest } = globalOpts;

  return vtuMount(component, {
    ...rest,
    global: {
      plugins: [...plugins],
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
      directives: {
        tooltip: tooltipDirective,
        ...directives,
      },
      ...globalRest,
    },
  });
}
