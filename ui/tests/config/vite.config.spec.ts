// @vitest-environment node
import viteConfig from '../../vite.config';

const getManualChunks = () => {
  const output = viteConfig.build?.rollupOptions?.output;
  const normalizedOutput = Array.isArray(output) ? output[0] : output;
  const { manualChunks } = normalizedOutput ?? {};

  expect(typeof manualChunks).toBe('function');
  if (typeof manualChunks !== 'function') {
    throw new Error('Expected build.rollupOptions.output.manualChunks to be a function');
  }

  return manualChunks;
};

describe('vite build configuration', () => {
  it('disables source maps for production builds', () => {
    expect(viteConfig.build?.sourcemap).toBe(false);
  });

  it('splits framework and icon vendor bundles using manual chunks', () => {
    const manualChunks = getManualChunks();

    expect(manualChunks('/Users/test/app/src/main.ts')).toBeUndefined();
    expect(manualChunks('/Users/test/app/node_modules/vue/dist/vue.runtime.esm-bundler.js')).toBe(
      'framework',
    );
    expect(manualChunks('/Users/test/app/node_modules/vue-router/dist/vue-router.mjs')).toBe(
      'framework',
    );
    expect(manualChunks('/Users/test/app/node_modules/iconify-icon/dist/iconify-icon.mjs')).toBe(
      'icons',
    );
    expect(
      manualChunks('/Users/test/app/node_modules/@headlessui/vue/dist/headlessui.esm.js'),
    ).toBe('vendor');
    expect(manualChunks('/Users/test/app/node_modules/pinia/dist/pinia.mjs')).toBe('vendor');
    expect(manualChunks('C:\\app\\node_modules\\vue\\dist\\vue.runtime.esm-bundler.js')).toBe(
      'framework',
    );
  });
});
