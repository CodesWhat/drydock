import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n/locales';
import type { ThemeFamily } from '../theme/palettes';
import type { RadiusPresetId } from './radius';

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
    security: { sortField: string; sortAsc: boolean; hiddenColumns: string[] };
    audit: { hiddenColumns: string[] };
    agents: { sortKey: string; sortAsc: boolean; hiddenColumns: string[] };
    triggers: Record<string, never>;
    watchers: { hiddenColumns: string[] };
    servers: { hiddenColumns: string[] };
    registries: Record<string, never>;
    notifications: Record<string, never>;
    auth: Record<string, never>;
  };
}

export const CURRENT_SCHEMA_VERSION = 8;

/**
 * Table-mode column keys for the five views that share the `DataTableColumnPicker`
 * infrastructure. Persisted preferences store the HIDDEN set (not the visible set) —
 * see `VIEW_TABLE_REQUIRED_COLUMN_KEYS` and `sanitizeViews` in `migrate.ts` — so a
 * column added in a future release is automatically visible for existing users.
 */
export const VIEW_TABLE_COLUMN_KEYS = {
  security: ['image', 'critical', 'high', 'medium', 'low', 'fixable', 'total'],
  watchers: ['name', 'status', 'containers', 'cron', 'nextRun', 'lastRun'],
  servers: ['name', 'host', 'status', 'containers', 'lastSeen'],
  audit: ['timestamp', 'action', 'containerName', 'status', 'details'],
  agents: ['name', 'status', 'containers', 'docker', 'os', 'version', 'lastSeen'],
} as const;

export type ViewTableColumnKey = keyof typeof VIEW_TABLE_COLUMN_KEYS;

export const VIEW_TABLE_REQUIRED_COLUMN_KEYS = {
  security: ['image'],
  watchers: ['name'],
  servers: ['name'],
  audit: ['containerName'],
  agents: ['name'],
} as const;

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
    security: { sortField: 'critical', sortAsc: false, hiddenColumns: [] },
    audit: { hiddenColumns: [] },
    agents: { sortKey: 'name', sortAsc: true, hiddenColumns: [] },
    triggers: {},
    watchers: { hiddenColumns: [] },
    servers: { hiddenColumns: [] },
    registries: {},
    notifications: {},
    auth: {},
  },
};
