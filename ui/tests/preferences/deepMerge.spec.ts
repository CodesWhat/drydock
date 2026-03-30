import { deepMerge } from '@/preferences/deepMerge';

describe('deepMerge', () => {
  it('keeps target keys when source omits them', () => {
    const target = {
      theme: { family: 'one-dark', variant: 'dark' },
      layout: { sidebarCollapsed: false },
    };

    const merged = deepMerge(structuredClone(target), {
      theme: { family: 'github' },
    });

    expect(merged.theme).toEqual({ family: 'github', variant: 'dark' });
    expect(merged.layout).toEqual({ sidebarCollapsed: false });
  });

  it('preserves array values from source when target has matching key', () => {
    const target = {
      dashboard: {
        widgetOrder: ['a', 'b'],
        hiddenWidgets: [],
        gridLayout: [] as { i: string; x: number; y: number; w: number; h: number }[],
      },
    };
    const source = {
      dashboard: {
        widgetOrder: ['b', 'a'],
        gridLayout: [{ i: 'a', x: 1, y: 2, w: 3, h: 4 }],
      },
    };

    const merged = deepMerge(structuredClone(target), source);

    expect(merged.dashboard.gridLayout).toEqual([{ i: 'a', x: 1, y: 2, w: 3, h: 4 }]);
    expect(merged.dashboard.widgetOrder).toEqual(['b', 'a']);
    expect(merged.dashboard.hiddenWidgets).toEqual([]);
  });

  it('does not overwrite with undefined source values', () => {
    const merged = deepMerge({ containers: { viewMode: 'table', groupByStack: false } }, {
      containers: { viewMode: undefined },
    } as unknown as Record<string, unknown>);

    expect(merged).toEqual({ containers: { viewMode: 'table', groupByStack: false } });
  });
});
