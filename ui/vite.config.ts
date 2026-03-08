import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'iconify-icon',
        },
      },
    }),
    tailwindcss(),
  ],

  resolve: {
    extensions: ['.vue', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    host: '0.0.0.0',
    port: 8080,
    proxy: {
      '^/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '^/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/');
          const nodeModulesSegment = '/node_modules/';
          const nodeModulesIndex = normalizedId.lastIndexOf(nodeModulesSegment);
          if (nodeModulesIndex === -1) {
            return undefined;
          }

          const packagePath = normalizedId.slice(nodeModulesIndex + nodeModulesSegment.length);
          const packageSegments = packagePath.split('/');
          const packageName = packageSegments[0]?.startsWith('@')
            ? `${packageSegments[0]}/${packageSegments[1] ?? ''}`
            : packageSegments[0];

          if (packageName === 'vue' || packageName === 'vue-router') {
            return 'framework';
          }

          if (packageName === 'iconify-icon') {
            return 'icons';
          }

          return 'vendor';
        },
      },
    },
  },

  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
});
