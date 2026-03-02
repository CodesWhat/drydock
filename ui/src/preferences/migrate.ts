import { type PreferencesSchema, DEFAULTS } from './schema';
import { deepMerge } from './deepMerge';
import {
  FONT_FAMILIES,
  ICON_LIBRARIES,
  RADIUS_PRESETS,
  TABLE_ACTIONS,
  THEME_FAMILIES,
  THEME_VARIANTS,
  isValidScale,
  isViewMode,
} from './validators';

/** Deep-merge source into a clone of defaults, preserving only keys that exist in defaults. */
export function mergeDefaults(source: Record<string, unknown>): PreferencesSchema {
  return deepMerge(structuredClone(DEFAULTS), source) as PreferencesSchema;
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

export function migrateFromLegacyKeys(): PreferencesSchema {
  const prefs: Record<string, unknown> = { schemaVersion: 1 };

  // Theme
  const family = readString('drydock-theme-family-v1');
  const variant = readString('drydock-theme-variant-v1');
  if ((family && THEME_FAMILIES.has(family)) || (variant && THEME_VARIANTS.has(variant))) {
    const t: Record<string, string> = {};
    if (family && THEME_FAMILIES.has(family)) t.family = family;
    if (variant && THEME_VARIANTS.has(variant)) t.variant = variant;
    prefs.theme = t;
  }

  // Font
  const font = readString('drydock-font-family-v1');
  if (font && FONT_FAMILIES.has(font)) prefs.font = { family: font };

  // Icons
  const iconLib = readString('drydock-icon-library-v1');
  const iconScaleRaw = readString('drydock-icon-scale-v1');
  const iconScale = iconScaleRaw ? Number.parseFloat(iconScaleRaw) : undefined;
  if ((iconLib && ICON_LIBRARIES.has(iconLib)) || (iconScale !== undefined && isValidScale(iconScale))) {
    const i: Record<string, unknown> = {};
    if (iconLib && ICON_LIBRARIES.has(iconLib)) i.library = iconLib;
    if (iconScale !== undefined && isValidScale(iconScale)) i.scale = iconScale;
    prefs.icons = i;
  }

  // Appearance
  const radius = readString('drydock-radius-v1');
  if (radius && RADIUS_PRESETS.has(radius)) prefs.appearance = { radius };

  // Layout
  const sidebar = readString('dd-sidebar-v1');
  if (sidebar !== undefined) {
    const parsed = readJSON('dd-sidebar-v1', isBoolean);
    if (parsed !== undefined) prefs.layout = { sidebarCollapsed: parsed };
  }

  // Containers
  const containers: Record<string, unknown> = {};
  const containerView = readString('dd-containers-view-v1');
  if (containerView && isViewMode(containerView)) containers.viewMode = containerView;

  const tableActions = readString('dd-table-actions-v1');
  if (tableActions && TABLE_ACTIONS.has(tableActions)) containers.tableActions = tableActions;

  const groupByStack = readString('dd-group-by-stack-v1');
  if (groupByStack === 'true' || groupByStack === 'false')
    containers.groupByStack = groupByStack === 'true';

  const sort = readJSON('dd-containers-sort-v1', isSortObject);
  if (sort) containers.sort = sort;

  const filters = readJSON('dd-containers-filters-v1', isLegacyFilters);
  if (filters) {
    const f: Record<string, string> = {};
    for (const key of ['status', 'registry', 'bouncer', 'server', 'kind'] as const) {
      if (typeof filters[key] === 'string') f[key] = filters[key] as string;
    }
    if (Object.keys(f).length > 0) containers.filters = f;
  }

  const columns = readJSON('dd-table-cols-v1', isStringArray);
  if (columns) containers.columns = columns;

  if (Object.keys(containers).length > 0) prefs.containers = containers;

  // Dashboard
  const widgetOrder = readJSON('dd-dashboard-widget-order-v3', isStringArray);
  if (widgetOrder) prefs.dashboard = { widgetOrder };

  // Views
  const views: Record<string, unknown> = {};

  // Security
  const secView = readString('dd-security-view-v1');
  const secSortField = readString('dd-security-sort-field-v1');
  const secSortAsc = readJSON('dd-security-sort-asc-v1', isBoolean);
  if ((secView && isViewMode(secView)) || secSortField !== undefined || secSortAsc !== undefined) {
    const s: Record<string, unknown> = {};
    if (secView && isViewMode(secView)) s.mode = secView;
    if (secSortField !== undefined) s.sortField = secSortField;
    if (secSortAsc !== undefined) s.sortAsc = secSortAsc;
    views.security = s;
  }

  // Audit
  const auditView = readString('dd-audit-view-v1');
  if (auditView && isViewMode(auditView)) views.audit = { mode: auditView };

  // Agents
  const agentsView = readString('dd-agents-view-v1');
  const agentsSortKey = readString('dd-agents-sort-key-v1');
  const agentsSortAsc = readJSON('dd-agents-sort-asc-v1', isBoolean);
  if (
    (agentsView && isViewMode(agentsView)) ||
    agentsSortKey !== undefined ||
    agentsSortAsc !== undefined
  ) {
    const a: Record<string, unknown> = {};
    if (agentsView && isViewMode(agentsView)) a.mode = agentsView;
    if (agentsSortKey !== undefined) a.sortKey = agentsSortKey;
    if (agentsSortAsc !== undefined) a.sortAsc = agentsSortAsc;
    views.agents = a;
  }

  // Simple view modes
  for (const [key, viewKey] of [
    ['triggers', 'dd-triggers-view-v1'],
    ['watchers', 'dd-watchers-view-v1'],
    ['servers', 'dd-servers-view-v1'],
    ['registries', 'dd-registries-view-v1'],
    ['notifications', 'dd-notifications-view-v1'],
    ['auth', 'dd-auth-view-v1'],
  ] as const) {
    const mode = readString(viewKey);
    if (mode && isViewMode(mode)) views[key] = { mode };
  }

  if (Object.keys(views).length > 0) prefs.views = views;

  const result = mergeDefaults(prefs);

  // Try to write and verify
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

  return result;
}

/** Run schema version migrations on existing preferences data. */
export function migrate(data: Record<string, unknown>): PreferencesSchema {
  // Future migrations:
  // if (data.schemaVersion === 1) { data = migrateV1toV2(data); }
  // if (data.schemaVersion === 2) { data = migrateV2toV3(data); }
  return mergeDefaults(data);
}
