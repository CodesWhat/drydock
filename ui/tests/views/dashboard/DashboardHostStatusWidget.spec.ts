import type { VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import DashboardHostStatusWidget from '@/views/dashboard/components/DashboardHostStatusWidget.vue';
import type { DashboardServerRow } from '@/views/dashboard/dashboardTypes';
import { mountWithPlugins } from '../../helpers/mount';

let resizeObserverCallback: ResizeObserverCallback | undefined;
const originalResizeObserver = globalThis.ResizeObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const mountedWrappers: VueWrapper[] = [];

class ResizeObserverTestMock {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {
    // No-op for tests.
  }

  unobserve() {
    // No-op for tests.
  }

  disconnect() {
    // No-op for tests.
  }
}

function makeServer(overrides: Partial<DashboardServerRow> = {}): DashboardServerRow {
  return {
    name: 'Local',
    host: 'unix:///var/run/docker.sock',
    status: 'connected',
    statusLabel: 'connected',
    containers: { running: 14, total: 15 },
    ...overrides,
  };
}

function makeDomRect(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 320,
    height,
    top: 0,
    right: 320,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function triggerResize(height: number) {
  if (!resizeObserverCallback) {
    throw new Error('ResizeObserver callback was not registered');
  }

  resizeObserverCallback(
    [
      {
        contentRect: {
          x: 0,
          y: 0,
          width: 320,
          height,
          top: 0,
          right: 320,
          bottom: height,
          left: 0,
          toJSON: () => ({}),
        },
      } as ResizeObserverEntry,
    ],
    {} as ResizeObserver,
  );
}

function mountWidget(
  overrides: Partial<InstanceType<typeof DashboardHostStatusWidget>['$props']> = {},
) {
  const wrapper = mountWithPlugins(DashboardHostStatusWidget, {
    props: {
      editMode: false,
      servers: [
        makeServer(),
        makeServer({
          name: 'nas-agent',
          host: '192.168.1.50:3001',
          containers: { running: 0, total: 0 },
        }),
      ],
      ...overrides,
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('DashboardHostStatusWidget', () => {
  beforeEach(() => {
    resizeObserverCallback = undefined;
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: ResizeObserverTestMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: originalResizeObserver,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      value: originalRequestAnimationFrame,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: originalCancelAnimationFrame,
      configurable: true,
      writable: true,
    });
  });

  it('top-aligns full-mode host rows so partially clipped rows keep their status badges anchored', async () => {
    const wrapper = mountWidget();

    triggerResize(320);
    await nextTick();

    const fullModeRows = wrapper.findAll('[data-host-row]');
    expect(fullModeRows.length).toBeGreaterThan(0);
    expect(fullModeRows[0].classes()).toContain('items-start');
    expect(fullModeRows[0].classes()).not.toContain('items-center');
  });

  it('snaps full-mode scrolling to host row boundaries', async () => {
    const wrapper = mountWidget();

    triggerResize(320);
    await nextTick();

    const scrollViewport = wrapper.find('.dd-scroll-stable');
    expect(scrollViewport.classes()).toContain('snap-y');
    expect(scrollViewport.classes()).toContain('snap-mandatory');

    const fullModeRows = wrapper.findAll('[data-host-row]');
    expect(fullModeRows.length).toBeGreaterThan(0);
    expect(fullModeRows[0].classes()).toContain('snap-start');
  });

  it('adds trailing spacer height so the last host row can snap fully into view', async () => {
    const wrapper = mountWidget({
      servers: [
        makeServer(),
        makeServer({
          name: 'nas-agent',
          host: '192.168.1.50:3001',
          containers: { running: 0, total: 0 },
        }),
        makeServer({
          name: 'edge-backup',
          host: '10.0.0.23:3001',
          containers: { running: 2, total: 2 },
        }),
      ],
    });

    triggerResize(320);
    await nextTick();

    const scrollViewport = wrapper.get('.dd-scroll-stable');
    Object.defineProperty(scrollViewport.element, 'clientHeight', {
      configurable: true,
      value: 240,
    });

    const fullModeRows = wrapper.findAll('[data-host-row]');
    vi.spyOn(
      fullModeRows[fullModeRows.length - 1].element,
      'getBoundingClientRect',
    ).mockReturnValue(makeDomRect(72));

    await wrapper.setProps({ editMode: true });
    await nextTick();
    await nextTick();

    const tailSpacer = wrapper.get('[data-test="host-status-tail-spacer"]');
    expect(tailSpacer.attributes('style')).toContain('height: 168px');
  });
});
