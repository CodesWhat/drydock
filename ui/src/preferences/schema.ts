import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n/locales';
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
  locale: { language: SupportedLocale };
  theme: { family: ThemeFamily; variant: string };
  font: { family: string };
  icons: { library: string; scale: number };
  appearance: { radius: RadiusPresetId; fontSize: number };
  layout: { sidebarCollapsed: boolean };
  containers: {
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
  tables: {
    columnWidths: Record<string, Record<string, number>>;
  };
  views: {
    logs: { newestFirst: boolean };
    security: { sortField: string; sortAsc: boolean };
    audit: Record<string, never>;
    agents: { sortKey: string; sortAsc: boolean };
    triggers: Record<string, never>;
    watchers: Record<string, never>;
    servers: Record<string, never>;
    registries: Record<string, never>;
    notifications: Record<string, never>;
    auth: Record<string, never>;
  };
}

export const CURRENT_SCHEMA_VERSION = 8;

export const CONTAINER_TABLE_COLUMN_KEYS = [
  'icon',
  'name',
  'version',
  'softwareVersion',
  'kind',
  'status',
  'server',
  'registry',
] as const;

export const CONTAINER_TABLE_OPT_IN_COLUMN_KEYS = ['uptime'] as const;

export const CONTAINER_TABLE_REQUIRED_COLUMN_KEYS = ['icon', 'name'] as const;

export const DEFAULTS: PreferencesSchema = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  locale: { language: DEFAULT_LOCALE },
  theme: { family: 'one-dark', variant: 'dark' },
  font: { family: 'ibm-plex-mono' },
  icons: { library: 'ph-duotone', scale: 1 },
  appearance: { radius: 'sharp', fontSize: 1 },
  layout: { sidebarCollapsed: false },
  containers: {
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
    gridLayouts: {
      xxs: undefined,
      xs: undefined,
      sm: undefined,
      md: undefined,
      lg: undefined,
    },
  },
  tables: {
    columnWidths: {},
  },
  views: {
    logs: { newestFirst: false },
    security: { sortField: 'critical', sortAsc: false },
    audit: {},
    agents: { sortKey: 'name', sortAsc: true },
    triggers: {},
    watchers: {},
    servers: {},
    registries: {},
    notifications: {},
    auth: {},
  },
};
