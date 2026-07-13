import { mount } from '@vue/test-utils';
import DashboardGrid from '@/views/dashboard/components/DashboardGrid.vue';

const layout = [
  { i: 'stat-containers', x: 0, y: 0, w: 3, h: 3 },
  { i: 'stat-security', x: 3, y: 0, w: 3, h: 3 },
  { i: 'stat-registries', x: 6, y: 0, w: 3, h: 3 },
] as const;

function pointerEvent(type: string, values: Record<string, unknown>) {
  return Object.assign(new Event(type, { bubbles: true }), values);
}

function mountGrid(overrides: Record<string, unknown> = {}) {
  return mount(DashboardGrid, {
    props: {
      layout: layout.map((item) => ({ ...item })),
      columns: 12,
      rowHeight: 30,
      margin: [16, 16],
      editable: true,
      hiddenItems: [],
      currentBreakpoint: 'lg',
      breakpoints: { xxs: 0, xs: 480, sm: 639, md: 640, lg: 1024 },
      responsiveLayouts: {},
      resizeLabel: 'Resize dashboard widget',
      ...overrides,
    },
    slots: {
      item: '<button class="drag-handle">Move</button><span class="content">Content</span>',
    },
  });
}

describe('DashboardGrid', () => {
  it('renders native CSS Grid cells and reorders a same-row drop', async () => {
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'stat-containers'),
    };
    const wrapper = mountGrid();

    expect(wrapper.get('.dd-dashboard-grid').attributes('style')).toContain(
      'grid-template-columns: repeat(12, minmax(0, 1fr))',
    );
    const cells = wrapper.findAll('.dd-grid-item');
    await cells[0]!.get('.drag-handle').trigger('pointerdown');
    await cells[0]!.trigger('dragstart', { dataTransfer });
    await cells[2]!.trigger('dragover', { dataTransfer });
    await cells[2]!.trigger('drop', { dataTransfer });

    const emitted = wrapper.emitted('update:layout');
    const updatedLayout = emitted?.at(-1)?.[0] as Array<{ i: string }> | undefined;
    expect(updatedLayout?.map((item) => item.i)).toEqual([
      'stat-security',
      'stat-registries',
      'stat-containers',
    ]);
    expect(wrapper.findAll('.dd-grid-resizer')).toHaveLength(3);
  });

  it('supports touch-pointer reordering for mobile dashboards', async () => {
    const wrapper = mountGrid({ breakpoints: { xxs: 0, lg: 1024 } });
    const cells = wrapper.findAll('.dd-grid-item');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => cells[2]!.element),
    });

    cells[0]!.get('.drag-handle').element.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 200,
        clientY: 10,
      }),
    );
    window.dispatchEvent(
      pointerEvent('pointerup', {
        pointerId: 7,
        pointerType: 'touch',
        clientX: 200,
        clientY: 10,
      }),
    );
    await wrapper.vm.$nextTick();

    const updatedLayout = wrapper.emitted('update:layout')?.at(-1)?.[0] as
      | Array<{ i: string }>
      | undefined;
    expect(updatedLayout?.map((item) => item.i)).toEqual([
      'stat-security',
      'stat-registries',
      'stat-containers',
    ]);
  });

  it('keeps the first touch drag active when a second pointer presses another handle', async () => {
    const wrapper = mountGrid();
    const cells = wrapper.findAll('.dd-grid-item');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => cells[2]!.element),
    });

    cells[0]!.get('.drag-handle').element.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 11,
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      }),
    );
    cells[1]!.get('.drag-handle').element.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 12,
        pointerType: 'touch',
        clientX: 100,
        clientY: 10,
      }),
    );
    window.dispatchEvent(
      pointerEvent('pointermove', {
        pointerId: 11,
        pointerType: 'touch',
        clientX: 200,
        clientY: 10,
      }),
    );
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 11, pointerType: 'touch' }));
    window.dispatchEvent(pointerEvent('pointercancel', { pointerId: 12, pointerType: 'touch' }));
    await wrapper.vm.$nextTick();

    const updatedLayout = wrapper.emitted('update:layout')?.at(-1)?.[0] as
      | Array<{ i: string }>
      | undefined;
    expect(updatedLayout?.map((item) => item.i)).toEqual([
      'stat-security',
      'stat-registries',
      'stat-containers',
    ]);
  });

  it('keeps read-only and invalid drag interactions inert', async () => {
    const readOnly = mountGrid({
      columns: 0,
      editable: false,
      hiddenItems: ['stat-security'],
    });
    expect(readOnly.get('.dd-dashboard-grid').attributes('style')).toContain(
      'grid-template-columns: repeat(1, minmax(0, 1fr))',
    );
    expect(readOnly.findAll('.dd-grid-resizer')).toHaveLength(0);
    expect(readOnly.findAll('.dd-grid-item')[1]!.attributes('style')).toContain('display: none');
    await readOnly.findAll('.dd-grid-item')[0]!.get('.drag-handle').trigger('pointerdown');
    await readOnly.findAll('.dd-grid-item')[0]!.trigger('dragstart');
    expect(readOnly.emitted('update:layout')).toBeUndefined();

    const editable = mountGrid();
    const cells = editable.findAll('.dd-grid-item');
    await cells[0]!.get('.content').trigger('pointerdown');
    await cells[0]!.trigger('dragstart');
    await cells[0]!.get('.drag-handle').trigger('pointerdown');
    await cells[0]!.trigger('dragstart');
    await cells[0]!.trigger('dragover');
    await cells[1]!.trigger('dragover');
    expect(cells[1]!.classes()).toContain('dd-grid-drop-target');
    await cells[1]!.trigger('dragleave');
    await cells[0]!.trigger('drop');
    await cells[0]!.trigger('dragend');
    expect(editable.emitted('update:layout')).toBeUndefined();

    const fallbackTransfer = { getData: vi.fn(() => 'stat-containers') };
    await cells[2]!.trigger('drop', { dataTransfer: fallbackTransfer });
    expect(editable.emitted('update:layout')).toHaveLength(1);
  });

  it('mounts without ResizeObserver support', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    try {
      const wrapper = mountGrid();
      expect(wrapper.find('.dd-dashboard-grid').exists()).toBe(true);
      wrapper.unmount();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it('ignores incomplete touch gestures and cleans active gestures on unmount', async () => {
    const wrapper = mountGrid();
    const cells = wrapper.findAll('.dd-grid-item');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => cells[0]!.element),
    });
    cells[0]!.get('.drag-handle').element.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 9,
        pointerType: 'touch',
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: 10, clientY: 30 }));
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 8 }));
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 11, clientY: 11 }));
    window.dispatchEvent(pointerEvent('pointermove', { pointerId: 9, clientX: 10, clientY: 30 }));
    window.dispatchEvent(pointerEvent('pointerup', { pointerId: 9 }));
    expect(wrapper.emitted('update:layout')).toBeUndefined();

    cells[0]!.get('.drag-handle').element.dispatchEvent(
      pointerEvent('pointerdown', {
        pointerId: 10,
        pointerType: 'pen',
        clientX: 10,
        clientY: 10,
      }),
    );
    wrapper.unmount();
  });

  it('resizes with widget bounds and fallback bounds', async () => {
    const boundedLayout = layout.map((item, index) => ({
      ...item,
      ...(index === 0 ? { breakpointBounds: { minW: 2, minH: 3, maxW: 4, maxH: 5 } } : {}),
    }));
    const wrapper = mountGrid({ layout: boundedLayout });
    vi.spyOn(wrapper.get('.dd-dashboard-grid').element, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
    } as DOMRect);
    const resizers = wrapper.findAll('.dd-grid-resizer');

    resizers[0]!.element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 500, clientY: 200 }));
    window.dispatchEvent(pointerEvent('pointercancel', {}));
    expect(
      (wrapper.emitted('update:layout')?.at(-1)?.[0] as Array<{ w: number; h: number }>)[0],
    ).toMatchObject({ w: 4, h: 5 });

    resizers[1]!.element.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(pointerEvent('pointermove', { clientX: 100, clientY: 50 }));
    window.dispatchEvent(pointerEvent('pointerup', {}));
    expect(wrapper.emitted('update:layout')?.length).toBeGreaterThan(1);
  });

  it('observes container breakpoint changes and disconnects cleanly', async () => {
    let callback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const originalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      constructor(nextCallback: ResizeObserverCallback) {
        callback = nextCallback;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    try {
      const xsLayout = layout.map((item) => ({ ...item, x: 0, w: 1 }));
      const wrapper = mountGrid({ responsiveLayouts: { xs: xsLayout } });
      expect(observe).toHaveBeenCalled();
      callback?.([], {} as ResizeObserver);
      callback?.([{ contentRect: { width: 1100 } } as ResizeObserverEntry], {} as ResizeObserver);
      callback?.([{ contentRect: { width: 500 } } as ResizeObserverEntry], {} as ResizeObserver);
      expect(wrapper.emitted('breakpoint-changed')?.at(-1)).toEqual(['xs', xsLayout]);
      await wrapper.setProps({ currentBreakpoint: 'xs' });
      callback?.([{ contentRect: { width: -1 } } as ResizeObserverEntry], {} as ResizeObserver);
      wrapper.unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });
});
