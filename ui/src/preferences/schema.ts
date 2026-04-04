import type { ThemeFamily } from '../theme/palettes';
import type { RadiusPresetId } from './radius';

export type ViewMode = 'table' | 'cards' | 'list';

export const DASHBOARD_LAYOUT_BREAKPOINTS = ['xxs', 'xs', 'sm', 'md', 'lg'] as const;
export type DashboardLayoutBreakpoint = (typeof DASHBOARD_LAYOUT_BREAKPOINTS)[number];

export interface PersistedLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PersistedResponsiveLayoutMap = Partial<
  Record<DashboardLayoutBreakpoint, PersistedLayoutItem[]>
>;

export interface PreferencesSchema {
  schemaVersion: number;
  theme: { family: ThemeFamily; variant: string };
  font: { family: string };
  icons: { library: string; scale: number };
  appearance: { radius: RadiusPresetId; fontSize: number };
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
      hidePinned: boolean;
    };
    columns: string[];
  };
  dashboard: {
    widgetOrder: string[];
    hiddenWidgets: string[];
    gridLayout: PersistedLayoutItem[];
    gridLayouts: PersistedResponsiveLayoutMap;
  };
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

export const CONTAINER_TABLE_COLUMN_KEYS = [
  'icon',
  'name',
  'version',
  'kind',
  'status',
  'imageAge',
  'server',
  'registry',
] as const;

export const CONTAINER_TABLE_REQUIRED_COLUMN_KEYS = ['icon', 'name'] as const;

export const DEFAULTS: PreferencesSchema = {
  schemaVersion: 1,
  theme: { family: 'one-dark', variant: 'dark' },
  font: { family: 'ibm-plex-mono' },
  icons: { library: 'ph-duotone', scale: 1 },
  appearance: { radius: 'sharp', fontSize: 1 },
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
      hidePinned: false,
    },
    columns: [...CONTAINER_TABLE_COLUMN_KEYS],
  },
  dashboard: {
    widgetOrder: [
      'stat-containers',
      'stat-updates',
      'stat-security',
      'stat-registries',
      'recent-updates',
      'security-overview',
      'resource-usage',
      'host-status',
      'update-breakdown',
    ],
    hiddenWidgets: [],
    gridLayout: [],
    gridLayouts: {},
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
