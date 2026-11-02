import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type Plugin } from 'vite';

const uiMainPath = fileURLToPath(new URL('../../ui/src/main.ts', import.meta.url));
const demoCssPath = fileURLToPath(new URL('./src/demo.css', import.meta.url));

// The UI entry imports './style.css'. Serve src/demo.css in its place so the
// demo has a single Tailwind build that carries the UI theme and scans ui/src.
function demoStylesheet(): Plugin {
  return {
    name: 'drydock-demo-stylesheet',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './style.css' && importer === uiMainPath) {
        return demoCssPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    demoStylesheet(),
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
      '@': fileURLToPath(new URL('../../ui/src', import.meta.url)),
    },
  },

  server: {
    fs: {
      allow: [
        // Allow serving files from the UI source and shared node_modules
        fileURLToPath(new URL('../..', import.meta.url)),
      ],
    },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },

  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
});
