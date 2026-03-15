const mockLogWarn = vi.hoisted(() => vi.fn());
vi.mock('../../log/index.js', () => ({
  default: { child: () => ({ warn: mockLogWarn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import { renderBatch, renderSimple } from './trigger-expression-parser.js';

const baseContainer = {
  id: 'c1',
  name: 'demo',
  watcher: 'local',
  updateKind: {
    kind: 'tag',
    localValue: '1.0.0',
    remoteValue: '1.1.0',
    semverDiff: 'minor',
  },
  result: {
    link: 'https://example.com/release',
    suggestedTag: '1.2.3',
  },
};

describe('trigger-expression-parser', () => {
  test('renderSimple and renderBatch should return empty string for nullish templates', () => {
    expect(renderSimple(undefined, baseContainer)).toBe('');
    expect(renderBatch(undefined, [baseContainer])).toBe('');
  });

  test('renderSimple should evaluate simple expressions and concat', () => {
    expect(
      renderSimple('${container.name.toUpperCase()}-${container.num + container.enabled}', {
        ...baseContainer,
        num: 12,
        enabled: true,
      }),
    ).toBe('DEMO-12true');
  });

  test('renderSimple should handle malformed ternary and method syntax safely', () => {
    expect(renderSimple('A${container.name ? "yes"}B', baseContainer)).toBe('AB');
    expect(renderSimple('A${container.name)}B', baseContainer)).toBe('AB');
    expect(renderSimple('A${container.name.-bad()}B', baseContainer)).toBe('AB');
  });

  test('renderSimple should return empty for missing paths and non-function methods', () => {
    expect(renderSimple('${container.none.value}', baseContainer)).toBe('');
    expect(
      renderSimple('${container.meta.missing()}', {
        ...baseContainer,
        meta: {},
      }),
    ).toBe('');
  });

  test('renderSimple should stringify symbols and fallback to empty string for circular objects', () => {
    const circular = {};
    circular.self = circular;
    const output = renderSimple('${container.sym}-${container.big}-${container.circular}', {
      ...baseContainer,
      sym: Symbol('value'),
      big: 1n,
      circular,
    });

    expect(output.startsWith('Symbol(value)-1-')).toBe(true);
    expect(output.endsWith('-')).toBe(true);
  });

  test('renderSimple should coerce null method results to empty strings in concatenation', () => {
    const output = renderSimple('${container.value.toString() + "x"}', {
      ...baseContainer,
      value: {
        toString: () => null,
      },
    });
    expect(output).toBe('x');
  });

  test('renderSimple should return empty when allowed method does not exist on target type', () => {
    const output = renderSimple('${container.count.toUpperCase()}', {
      ...baseContainer,
      count: 123,
    });
    expect(output).toBe('');
  });

  test('renderSimple should treat undefined JSON.stringify results as empty strings in concat', () => {
    const output = renderSimple('${container.fn + "suffix"}', {
      ...baseContainer,
      fn() {
        return 'ignored';
      },
    });
    expect(output).toBe('suffix');
  });

  test('renderSimple should expose suggestedTag template variable', () => {
    const output = renderSimple('Pin to ${suggestedTag}', baseContainer as any);
    expect(output).toBe('Pin to 1.2.3');
  });
});

describe('legacy template variable deprecation warnings', () => {
  beforeEach(() => {
    mockLogWarn.mockClear();
  });

  test('renderSimple should warn about legacy template variables', async () => {
    vi.resetModules();
    const { renderSimple: freshRenderSimple } = await import('./trigger-expression-parser.js');

    freshRenderSimple('Hello ${name}, id=${id}', baseContainer);

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger template variable "${name}" is deprecated'),
    );
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger template variable "${id}" is deprecated'),
    );
  });

  test('renderBatch should warn about legacy count variable', async () => {
    vi.resetModules();
    const { renderBatch: freshRenderBatch } = await import('./trigger-expression-parser.js');

    freshRenderBatch('Total: ${count}', [baseContainer]);

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.stringContaining('Legacy trigger template variable "${count}" is deprecated'),
    );
  });

  test('should not warn for non-legacy template variables', async () => {
    vi.resetModules();
    const { renderSimple: freshRenderSimple } = await import('./trigger-expression-parser.js');

    freshRenderSimple('Hello ${container.name}', baseContainer);

    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});
