import type { ThemeFamily } from '../theme/palettes';

export type ViewMode = 'table' | 'cards' | 'list';

export interface PreferencesSchema {
  schemaVersion: number;
  theme: { family: ThemeFamily; variant: string };
  font: { family: string };
  icons: { library: string; scale: number };
  appearance: { radius: string };
  layout: { sidebarCollapsed: boolean };
  containers: {
    viewMode: ViewMode;
    tableActions: 'icons' | 'buttons';
    groupByStack: boolean;
    sort: { key: string; asc: boolean };
    filters: {
      status: string;
      registry: string;
      bouncer: string;
      server: string;
      kind: string;
    };
    columns: string[];
  };
  dashboard: { widgetOrder: string[] };
  views: {
    security: { mode: ViewMode; sortField: string; sortAsc: boolean };
    audit: { mode: ViewMode };
    agents: { mode: ViewMode; sortKey: string; sortAsc: boolean };
    triggers: { mode: ViewMode };
    watchers: { mode: ViewMode };
    servers: { mode: ViewMode };
    registries: { mode: ViewMode };
    notifications: { mode: ViewMode };
    auth: { mode: ViewMode };
  };
}

export const DEFAULTS: PreferencesSchema = {
  schemaVersion: 1,
  theme: { family: 'drydock', variant: 'dark' },
  font: { family: 'ibm-plex-mono' },
  icons: { library: 'ph-duotone', scale: 1 },
  appearance: { radius: 'sharp' },
  layout: { sidebarCollapsed: false },
  containers: {
    viewMode: 'table',
    tableActions: 'icons',
    groupByStack: false,
    sort: { key: 'name', asc: true },
    filters: {
      status: 'all',
      registry: 'all',
      bouncer: 'all',
      server: 'all',
      kind: 'all',
    },
    columns: ['icon', 'name', 'version', 'kind', 'status', 'bouncer', 'server', 'registry'],
  },
  dashboard: {
    widgetOrder: [
      'stat-containers',
      'stat-updates',
      'stat-security',
      'stat-registries',
      'recent-updates',
      'security-overview',
      'host-status',
      'update-breakdown',
    ],
  },
  views: {
    security: { mode: 'table', sortField: 'critical', sortAsc: false },
    audit: { mode: 'table' },
    agents: { mode: 'table', sortKey: 'name', sortAsc: true },
    triggers: { mode: 'table' },
    watchers: { mode: 'table' },
    servers: { mode: 'table' },
    registries: { mode: 'table' },
    notifications: { mode: 'table' },
    auth: { mode: 'table' },
  },
};
