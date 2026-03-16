/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // biome-ignore lint/complexity/noBannedTypes: standard Vue SFC type declaration
  const component: DefineComponent;
  export default component;
}

declare module '*.svg' {
  const content: string;
  export default content;
}
