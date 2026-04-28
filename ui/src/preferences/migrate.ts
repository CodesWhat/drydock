import { deepMerge } from './deepMerge';
import {
  CONTAINER_TABLE_COLUMN_KEYS,
  CONTAINER_TABLE_REQUIRED_COLUMN_KEYS,
  CURRENT_SCHEMA_VERSION,
  DASHBOARD_LAYOUT_BREAKPOINTS,
  type DashboardLayoutBreakpoint,
  DEFAULTS,
  type PreferencesSchema,
} from './schema';
import {
  FONT_FAMILIES,
  ICON_LIBRARIES,
  isValidFontSize,
  isValidScale,
  isViewMode,
  RADIUS_PRESETS,
  TABLE_ACTIONS,
  THEME_FAMILIES,
  THEME_VARIANTS,
} from './validators';

/** Deep-merge source into a clone of defaults, preserving only keys that exist in defaults. */
export function mergeDefaults(source: Record<string, unknown>): PreferencesSchema {
  return deepMerge(structuredClone(DEFAULTS), source) as PreferencesSchema;
}

// ─── Sanitize persisted data ─────────────────────────────────

function deleteIfInvalid(obj: Record<string, unknown>, key: string, allow: Set<string>): void {
  if (typeof obj[key] === 'string' && !allow.has(obj[key] as string)) {
    delete obj[key];
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isLegacySingleColumnGridLayout(layout: unknown[]): boolean {
  return (
    layout.length > 0 &&
    layout.every((item) => {
      if (!isRecord(item)) {
        return false;
      }
      return item.x === 0 && item.w === 1;
    })
  );
}

function getMutableDashboard(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const dashboard = data.dashboard;
  return isRecord(dashboard) ? dashboard : undefined;
}

function pruneResponsiveDashboardLayouts(
  dashboard: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!('gridLayouts' in dashboard)) {
    return undefined;
  }

  if (!isRecord(dashboard.gridLayouts)) {
    delete dashboard.gridLayouts;
    return undefined;
  }

  for (const key of Object.keys(dashboard.gridLayouts)) {
    if (
      !(DASHBOARD_LAYOUT_BREAKPOINTS as readonly string[]).includes(key) ||
      !Array.isArray(dashboard.gridLayouts[key])
    ) {
      delete dashboard.gridLayouts[key];
    }
  }

  return dashboard.gridLayouts;
}

function normalizeLegacyGridLayout(
  dashboard: Record<string, unknown>,
  responsiveLayouts: Record<string, unknown> | undefined,
): void {
  if (!Array.isArray(dashboard.gridLayout)) {
    if ('gridLayout' in dashboard) {
      delete dashboard.gridLayout;
    }
    return;
  }

  if (responsiveLayouts && Object.keys(responsiveLayouts).length > 0) {
    dashboard.gridLayouts = responsiveLayouts;
    return;
  }

  const breakpoint: DashboardLayoutBreakpoint = isLegacySingleColumnGridLayout(dashboard.gridLayout)
    ? 'sm'
    : 'lg';
  dashboard.gridLayouts = { [breakpoint]: dashboard.gridLayout };
}

function normalizeDashboardLayouts(data: Record<string, unknown>): void {
  const dashboard = getMutableDashboard(data);
  if (!dashboard) {
    return;
  }

  const responsiveLayouts = pruneResponsiveDashboardLayouts(dashboard);
  normalizeLegacyGridLayout(dashboard, responsiveLayouts);
}

/**
 * Remove invalid enum values from persisted preferences so that
 * deepMerge preserves defaults for those fields instead of
 * overwriting them with stale/renamed values (e.g. 'drydock' theme).
 */
function sanitize(data: Record<string, unknown>): void {
  normalizeDashboardLayouts(data);
  sanitizeTheme(data);
  sanitizeFont(data);
  sanitizeIcons(data);
  sanitizeAppearance(data);
  sanitizeContainers(data);
  sanitizeViews(data);
}

function sanitizeTheme(data: Record<string, unknown>): void {
  const theme = data.theme;
  if (theme && typeof theme === 'object') {
    const t = theme as Record<string, unknown>;
    deleteIfInvalid(t, 'family', THEME_FAMILIES);
    deleteIfInvalid(t, 'variant', THEME_VARIANTS);
  }
}

function sanitizeFont(data: Record<string, unknown>): void {
  const font = data.font;
  if (font && typeof font === 'object') {
    deleteIfInvalid(font as Record<string, unknown>, 'family', FONT_FAMILIES);
  }
}

function sanitizeIcons(data: Record<string, unknown>): void {
  const icons = data.icons;
  if (icons && typeof icons === 'object') {
    const i = icons as Record<string, unknown>;
    deleteIfInvalid(i, 'library', ICON_LIBRARIES);
    if ('scale' in i && !isValidScale(i.scale)) {
      delete i.scale;
    }
  }
}

function sanitizeAppearance(data: Record<string, unknown>): void {
  const appearance = data.appearance;
  if (appearance && typeof appearance === 'object') {
    const a = appearance as Record<string, unknown>;
    deleteIfInvalid(a, 'radius', RADIUS_PRESETS);
    if ('fontSize' in a && !isValidFontSize(a.fontSize)) {
      delete a.fontSize;
    }
  }
}

function sanitizeContainers(data: Record<string, unknown>): void {
  const containers = data.containers;
  if (containers && typeof containers === 'object') {
    const c = containers as Record<string, unknown>;
    if ('viewMode' in c && !isViewMode(c.viewMode)) delete c.viewMode;
    deleteIfInvalid(c, 'tableActions', TABLE_ACTIONS);

    if ('columns' in c) {
      if (!isStringArray(c.columns)) {
        delete c.columns;
      } else {
        const visible = new Set(c.columns);
        c.columns = CONTAINER_TABLE_COLUMN_KEYS.filter(
          (key) =>
            visible.has(key) ||
            (CONTAINER_TABLE_REQUIRED_COLUMN_KEYS as readonly string[]).includes(key),
        );
      }
    }
  }
}

function sanitizeViews(data: Record<string, unknown>): void {
  const views = data.views;
  if (views && typeof views === 'object') {
    const v = views as Record<string, unknown>;
    if ('logs' in v) {
      if (!isRecord(v.logs)) {
        delete v.logs;
      } else {
        const logs = v.logs as Record<string, unknown>;
        if ('newestFirst' in logs && !isBoolean(logs.newestFirst)) {
          delete logs.newestFirst;
        }
      }
    }
  }
}

// ─── Legacy key readers ─────────────────────────────────────

function readString(key: string): string | undefined {
  try {
    const v = localStorage.getItem(key);
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

function readJSON<T>(key: string, guard: (v: unknown) => v is T): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isSortObject(v: unknown): v is { key: string; asc: boolean } {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).key === 'string' &&
    typeof (v as Record<string, unknown>).asc === 'boolean'
  );
}

interface LegacyFilters {
  status?: string;
  registry?: string;
  bouncer?: string;
  server?: string;
  kind?: string;
}

function isLegacyFilters(v: unknown): v is LegacyFilters {
  return v !== null && typeof v === 'object';
}

// ─── Legacy key migration ───────────────────────────────────

const LEGACY_KEYS = [
  'drydock-theme-family-v1',
  'drydock-theme-variant-v1',
  'drydock-font-family-v1',
  'drydock-icon-library-v1',
  'drydock-icon-scale-v1',
  'drydock-radius-v1',
  'dd-sidebar-v1',
  'dd-table-cols-v1',
  'dd-containers-filters-v1',
  'dd-containers-sort-v1',
  'dd-containers-view-v1',
  'dd-table-actions-v1',
  'dd-group-by-stack-v1',
  'dd-dashboard-widget-order-v3',
  'dd-security-view-v1',
  'dd-security-sort-field-v1',
  'dd-security-sort-asc-v1',
  'dd-audit-view-v1',
  'dd-agents-view-v1',
  'dd-agents-sort-key-v1',
  'dd-agents-sort-asc-v1',
  'dd-triggers-view-v1',
  'dd-watchers-view-v1',
  'dd-servers-view-v1',
  'dd-registries-view-v1',
  'dd-notifications-view-v1',
  'dd-auth-view-v1',
] as const;

function cleanupLegacyKeys(): void {
  for (const key of LEGACY_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Individual key removal failure is non-critical
    }
  }
}

function scheduleLegacyKeyCleanup(): void {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(() => cleanupLegacyKeys());
    return;
  }

  setTimeout(() => cleanupLegacyKeys(), 0);
}

const LEGACY_FILTER_KEYS = ['status', 'registry', 'bouncer', 'server', 'kind'] as const;
const SIMPLE_VIEW_MODE_KEYS = [
  ['triggers', 'dd-triggers-view-v1'],
  ['watchers', 'dd-watchers-view-v1'],
  ['servers', 'dd-servers-view-v1'],
  ['registries', 'dd-registries-view-v1'],
  ['notifications', 'dd-notifications-view-v1'],
  ['auth', 'dd-auth-view-v1'],
] as const;

function migrateThemePreference(): Record<string, string> | undefined {
  const family = readString('drydock-theme-family-v1');
  const variant = readString('drydock-theme-variant-v1');
  if (!family && !variant) {
    return undefined;
  }

  const theme: Record<string, string> = {};
  if (family && THEME_FAMILIES.has(family)) {
    theme.family = family;
  }
  if (variant && THEME_VARIANTS.has(variant)) {
    theme.variant = variant;
  }

  return Object.keys(theme).length > 0 ? theme : undefined;
}

function migrateFontPreference(): { family: string } | undefined {
  const font = readString('drydock-font-family-v1');
  if (font && FONT_FAMILIES.has(font)) {
    return { family: font };
  }
  return undefined;
}

function migrateIconsPreference(): Record<string, unknown> | undefined {
  const iconLib = readString('drydock-icon-library-v1');
  const iconScaleRaw = readString('drydock-icon-scale-v1');
  const iconScale = iconScaleRaw ? Number.parseFloat(iconScaleRaw) : undefined;
  if (
    (!iconLib || !ICON_LIBRARIES.has(iconLib)) &&
    (iconScale === undefined || !isValidScale(iconScale))
  ) {
    return undefined;
  }

  const icons: Record<string, unknown> = {};
  if (iconLib && ICON_LIBRARIES.has(iconLib)) {
    icons.library = iconLib;
  }
  if (iconScale !== undefined && isValidScale(iconScale)) {
    icons.scale = iconScale;
  }
  return icons;
}

function migrateAppearancePreference(): { radius: string } | undefined {
  const radius = readString('drydock-radius-v1');
  if (radius && RADIUS_PRESETS.has(radius)) {
    return { radius };
  }
  return undefined;
}

function migrateLayoutPreference(): { sidebarCollapsed: boolean } | undefined {
  const sidebar = readString('dd-sidebar-v1');
  if (sidebar === undefined) {
    return undefined;
  }

  const parsed = readJSON('dd-sidebar-v1', isBoolean);
  if (parsed === undefined) {
    return undefined;
  }
  return { sidebarCollapsed: parsed };
}

function migrateContainerFilters(): Record<string, string> | undefined {
  const filters = readJSON('dd-containers-filters-v1', isLegacyFilters);
  if (!filters) {
    return undefined;
  }

  const migrated: Record<string, string> = {};
  for (const key of LEGACY_FILTER_KEYS) {
    const value = filters[key];
    if (typeof value === 'string') {
      migrated[key] = value;
    }
  }

  return Object.keys(migrated).length > 0 ? migrated : undefined;
}

function migrateContainersPreference(): Record<string, unknown> | undefined {
  const containers: Record<string, unknown> = {};

  const containerView = readString('dd-containers-view-v1');
  if (containerView && isViewMode(containerView)) {
    containers.viewMode = containerView;
  }

  const tableActions = readString('dd-table-actions-v1');
  if (tableActions && TABLE_ACTIONS.has(tableActions)) {
    containers.tableActions = tableActions;
  }

  const groupByStack = readString('dd-group-by-stack-v1');
  if (groupByStack === 'true' || groupByStack === 'false') {
    containers.groupByStack = groupByStack === 'true';
  }

  const sort = readJSON('dd-containers-sort-v1', isSortObject);
  if (sort) {
    containers.sort = sort;
  }

  const filters = migrateContainerFilters();
  if (filters) {
    containers.filters = filters;
  }

  const columns = readJSON('dd-table-cols-v1', isStringArray);
  if (columns) {
    containers.columns = columns;
  }

  return Object.keys(containers).length > 0 ? containers : undefined;
}

function migrateDashboardPreference(): { widgetOrder: string[] } | undefined {
  const widgetOrder = readJSON('dd-dashboard-widget-order-v3', isStringArray);
  if (widgetOrder) {
    return { widgetOrder };
  }
  return undefined;
}

function migrateSortableViewPreference(args: {
  viewKey: string;
  sortFieldKey: string;
  sortFieldOutputKey: string;
  sortAscKey: string;
}): Record<string, unknown> | undefined {
  const view = readString(args.viewKey);
  const sortField = readString(args.sortFieldKey);
  const sortAsc = readJSON(args.sortAscKey, isBoolean);
  if (!view && sortField === undefined && sortAsc === undefined) {
    return undefined;
  }

  const preference: Record<string, unknown> = {};
  if (view && isViewMode(view)) {
    preference.mode = view;
  }
  if (sortField !== undefined) {
    preference[args.sortFieldOutputKey] = sortField;
  }
  if (sortAsc !== undefined) {
    preference.sortAsc = sortAsc;
  }

  return Object.keys(preference).length > 0 ? preference : undefined;
}

function migrateSecurityViewPreference(): Record<string, unknown> | undefined {
  return migrateSortableViewPreference({
    viewKey: 'dd-security-view-v1',
    sortFieldKey: 'dd-security-sort-field-v1',
    sortFieldOutputKey: 'sortField',
    sortAscKey: 'dd-security-sort-asc-v1',
  });
}

function migrateAuditViewPreference(): { mode: string } | undefined {
  const auditView = readString('dd-audit-view-v1');
  if (auditView && isViewMode(auditView)) {
    return { mode: auditView };
  }
  return undefined;
}

function migrateAgentsViewPreference(): Record<string, unknown> | undefined {
  return migrateSortableViewPreference({
    viewKey: 'dd-agents-view-v1',
    sortFieldKey: 'dd-agents-sort-key-v1',
    sortFieldOutputKey: 'sortKey',
    sortAscKey: 'dd-agents-sort-asc-v1',
  });
}

function migrateSimpleViewModePreferences(): Record<string, { mode: string }> {
  const views: Record<string, { mode: string }> = {};
  for (const [key, viewKey] of SIMPLE_VIEW_MODE_KEYS) {
    const mode = readString(viewKey);
    if (mode && isViewMode(mode)) {
      views[key] = { mode };
    }
  }
  return views;
}

function migrateViewsPreference(): Record<string, unknown> | undefined {
  const views: Record<string, unknown> = {};

  const security = migrateSecurityViewPreference();
  if (security) {
    views.security = security;
  }

  const audit = migrateAuditViewPreference();
  if (audit) {
    views.audit = audit;
  }

  const agents = migrateAgentsViewPreference();
  if (agents) {
    views.agents = agents;
  }

  Object.assign(views, migrateSimpleViewModePreferences());

  return Object.keys(views).length > 0 ? views : undefined;
}

function persistMigratedPreferences(result: PreferencesSchema): void {
  try {
    const json = JSON.stringify(result);
    localStorage.setItem('dd-preferences', json);
    const readback = localStorage.getItem('dd-preferences');
    if (readback === json) {
      // Successful write — defer legacy cleanup to avoid blocking initial render.
      scheduleLegacyKeyCleanup();
    }
  } catch {
    // Write failed (quota/private browsing) — keep legacy keys intact
  }
}

export function migrateFromLegacyKeys(): PreferencesSchema {
  const prefs: Record<string, unknown> = { schemaVersion: CURRENT_SCHEMA_VERSION };
  const theme = migrateThemePreference();
  if (theme) {
    prefs.theme = theme;
  }

  const font = migrateFontPreference();
  if (font) {
    prefs.font = font;
  }

  const icons = migrateIconsPreference();
  if (icons) {
    prefs.icons = icons;
  }

  const appearance = migrateAppearancePreference();
  if (appearance) {
    prefs.appearance = appearance;
  }

  const layout = migrateLayoutPreference();
  if (layout) {
    prefs.layout = layout;
  }

  const containers = migrateContainersPreference();
  if (containers) {
    prefs.containers = containers;
  }

  const dashboard = migrateDashboardPreference();
  if (dashboard) {
    prefs.dashboard = dashboard;
  }

  const views = migrateViewsPreference();
  if (views) {
    prefs.views = views;
  }

  sanitize(prefs);
  const result = mergeDefaults(prefs);
  persistMigratedPreferences(result);
  return result;
}

/** Run schema version migrations on existing preferences data. */
export function migrate(data: Record<string, unknown>): PreferencesSchema {
  if (data.schemaVersion === 1) {
    data = {
      ...data,
      schemaVersion: 2,
      views: {
        ...(isRecord(data.views) ? data.views : {}),
        logs: {
          newestFirst: DEFAULTS.views.logs.newestFirst,
          ...(isRecord(data.views) && isRecord(data.views.logs) ? data.views.logs : {}),
        },
      },
    };
  }

  if (data.schemaVersion === 2) {
    data = { ...data, schemaVersion: 3 };
  }

  if (data.schemaVersion === 3) {
    data = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION };
  }

  sanitize(data);
  return mergeDefaults(data);
}
