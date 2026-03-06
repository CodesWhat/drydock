export {};

/* prettier-ignore */
declare module 'vue' {
  export interface GlobalComponents {
    AppIcon: typeof import('./src/components/AppIcon.vue')['default'];
    ConfirmDialog: typeof import('./src/components/ConfirmDialog.vue')['default'];
    ContainerIcon: typeof import('./src/components/ContainerIcon.vue')['default'];
    DataCardGrid: typeof import('./src/components/DataCardGrid.vue')['default'];
    DataFilterBar: typeof import('./src/components/DataFilterBar.vue')['default'];
    DataListAccordion: typeof import('./src/components/DataListAccordion.vue')['default'];
    DataTable: typeof import('./src/components/DataTable.vue')['default'];
    DataViewLayout: typeof import('./src/components/DataViewLayout.vue')['default'];
    DetailPanel: typeof import('./src/components/DetailPanel.vue')['default'];
    EmptyState: typeof import('./src/components/EmptyState.vue')['default'];
    RouterLink: typeof import('vue-router')['RouterLink'];
    RouterView: typeof import('vue-router')['RouterView'];
    ThemeToggle: typeof import('./src/components/ThemeToggle.vue')['default'];
  }
  export interface GlobalDirectives {
    Tooltip: typeof import('./src/directives/tooltip')['tooltip'];
  }
}
