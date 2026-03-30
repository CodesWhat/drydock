// @vitest-environment node
import viteConfig from '../../vite.config';

type CodeSplittingGroup = { name: string; test: RegExp };

const getCodeSplittingGroups = (): CodeSplittingGroup[] => {
  const output = viteConfig.build?.rolldownOptions?.output;
  const normalizedOutput = Array.isArray(output) ? output[0] : output;
  const groups = (normalizedOutput as Record<string, unknown>)?.codeSplitting as
    | { groups: CodeSplittingGroup[] }
    | undefined;

  expect(groups?.groups).toBeDefined();
  expect(Array.isArray(groups?.groups)).toBe(true);

  return groups!.groups;
};

const findGroup = (groups: CodeSplittingGroup[], path: string): string | undefined =>
  groups.find((g) => g.test.test(path))?.name;

describe('vite build configuration', () => {
  it('disables source maps for production builds', () => {
    expect(viteConfig.build?.sourcemap).toBe(false);
  });

  it('splits framework and icon vendor bundles using codeSplitting groups', () => {
    const groups = getCodeSplittingGroups();

    expect(findGroup(groups, '/Users/test/app/src/main.ts')).toBeUndefined();
    expect(
      findGroup(groups, '/Users/test/app/node_modules/vue/dist/vue.runtime.esm-bundler.js'),
    ).toBe('framework');
    expect(findGroup(groups, '/Users/test/app/node_modules/vue-router/dist/vue-router.mjs')).toBe(
      'framework',
    );
    expect(
      findGroup(groups, '/Users/test/app/node_modules/iconify-icon/dist/iconify-icon.mjs'),
    ).toBe('icons');
    expect(
      findGroup(groups, '/Users/test/app/node_modules/@headlessui/vue/dist/headlessui.esm.js'),
    ).toBe('vendor');
    expect(findGroup(groups, '/Users/test/app/node_modules/pinia/dist/pinia.mjs')).toBe('vendor');
    expect(findGroup(groups, 'C:\\app\\node_modules\\vue\\dist\\vue.runtime.esm-bundler.js')).toBe(
      'framework',
    );
  });

  it('defines exactly three codeSplitting groups in priority order', () => {
    const groups = getCodeSplittingGroups();

    expect(groups).toHaveLength(3);
    expect(groups[0]?.name).toBe('framework');
    expect(groups[1]?.name).toBe('icons');
    expect(groups[2]?.name).toBe('vendor');
  });
});
