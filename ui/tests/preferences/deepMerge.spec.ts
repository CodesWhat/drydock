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

  it('does not overwrite with undefined source values', () => {
    const merged = deepMerge({ containers: { viewMode: 'table', groupByStack: false } }, {
      containers: { viewMode: undefined },
    } as unknown as Record<string, unknown>);

    expect(merged).toEqual({ containers: { viewMode: 'table', groupByStack: false } });
  });
});
