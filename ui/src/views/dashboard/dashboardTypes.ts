import type { RouteLocationRaw } from 'vue-router';
import type { Container, ContainerReleaseNotes, UpdateEligibility } from '../../types/container';

export const DASHBOARD_WIDGET_IDS = [
  'stat-containers',
  'stat-updates',
  'stat-security',
  'stat-registries',
  'recent-updates',
  'security-overview',
  'resource-usage',
  'host-status',
  'update-breakdown',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

interface DashboardWidgetMeta {
  id: DashboardWidgetId;
  labelKey: string;
  category: 'stat' | 'widget';
  canStretch: boolean;
  defaultSpan: number;
}

export const DASHBOARD_WIDGET_META: DashboardWidgetMeta[] = [
  {
    id: 'stat-containers',
    labelKey: 'dashboardView.widgets.statContainers',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'stat-updates',
    labelKey: 'dashboardView.widgets.statUpdates',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'stat-security',
    labelKey: 'dashboardView.widgets.statSecurity',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'stat-registries',
    labelKey: 'dashboardView.widgets.statRegistries',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'recent-updates',
    labelKey: 'dashboardView.widgets.recentUpdates',
    category: 'widget',
    canStretch: true,
    defaultSpan: 2,
  },
  {
    id: 'security-overview',
    labelKey: 'dashboardView.widgets.securityOverview',
    category: 'widget',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'resource-usage',
    labelKey: 'dashboardView.widgets.resourceUsage',
    category: 'widget',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'host-status',
    labelKey: 'dashboardView.widgets.hostStatus',
    category: 'widget',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'update-breakdown',
    labelKey: 'dashboardView.widgets.updateBreakdown',
    category: 'widget',
    canStretch: true,
    defaultSpan: 2,
  },
];

export interface WidgetOrderItem {
  id: DashboardWidgetId;
}

export interface DashboardServerInfo {
  configuration?: {
    webhook?: {
      enabled?: boolean;
    };
  };
}

export interface DashboardAgent {
  name: string;
  connected: boolean;
  host?: string;
  port?: number | string;
}

export interface DashboardContainerSummary {
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  security: {
    issues: number;
  };
}

export type RecentAuditStatus = 'updated' | 'pending' | 'failed';

export interface DashboardStatCard {
  id: DashboardWidgetId;
  label: string;
  value: string;
  icon: string;
  color: string;
  colorMuted: string;
  route?: RouteLocationRaw;
  detail?: string;
}

export interface RecentUpdateRow {
  id: string;
  identityKey: string;
  name: string;
  image: string;
  icon: string;
  oldVer: string;
  newVer: string;
  releaseLink?: string;
  sourceRepo?: string;
  releaseNotes?: ContainerReleaseNotes | null;
  currentReleaseNotes?: ContainerReleaseNotes | null;
  registry?: Container['registry'];
  registryName?: string;
  registryUrl?: string;
  batchId?: string;
  queuePosition?: number;
  queueTotal?: number;
  status:
    | 'updated'
    | 'pending'
    | 'failed'
    | 'error'
    | 'snoozed'
    | 'skipped'
    | 'maturity-blocked'
    | 'queued'
    | 'updating';
  updateKind: UpdateKind | null;
  running: boolean;
  registryError?: string;
  blocked: boolean;
  updateEligibility?: UpdateEligibility;
}

export interface DashboardUpdateSequenceEntry {
  position: number;
  total: number;
}

export interface DashboardServerRow {
  name: string;
  host?: string;
  status: 'connected' | 'disconnected';
  statusLabel?: string;
  containers: { running: number; total: number };
}

export type UpdateKind = NonNullable<Container['updateKind']>;

export interface UpdateBreakdownBucket {
  kind: UpdateKind;
  label: string;
  color: string;
  colorMuted: string;
  icon: string;
  count: number;
}
