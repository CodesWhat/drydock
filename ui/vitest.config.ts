import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue(), vuetify()],
  resolve: {
    // Keep Vue SFC resolution behavior aligned with prior Jest setup.
    extensions: ['.vue', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@vue/devtools-api': fileURLToPath(
        new URL('./tests/mocks/vueDevtoolsApiMock.js', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.spec.ts'],
    css: true,
    server: {
      deps: {
        inline: ['vuetify'],
      },
    },
    transformMode: {
      web: [/\.vue$/],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{js,ts,vue}'],
      exclude: ['src/main.ts', 'src/registerServiceWorker.ts', '**/node_modules/**'],
    },
  },
});
