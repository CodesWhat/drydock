import type { RouteLocationRaw } from 'vue-router';
import type { Container } from '../../types/container';

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
  label: string;
  category: 'stat' | 'widget';
  canStretch: boolean;
  defaultSpan: number;
}

export const DASHBOARD_WIDGET_META: DashboardWidgetMeta[] = [
  {
    id: 'stat-containers',
    label: 'Containers',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'stat-updates',
    label: 'Updates Available',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'stat-security',
    label: 'Security Issues',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'stat-registries',
    label: 'Registries',
    category: 'stat',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'recent-updates',
    label: 'Updates Available',
    category: 'widget',
    canStretch: true,
    defaultSpan: 2,
  },
  {
    id: 'security-overview',
    label: 'Security Overview',
    category: 'widget',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'resource-usage',
    label: 'Resource Usage',
    category: 'widget',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'host-status',
    label: 'Host Status',
    category: 'widget',
    canStretch: false,
    defaultSpan: 1,
  },
  {
    id: 'update-breakdown',
    label: 'Update Breakdown',
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
  name: string;
  image: string;
  icon: string;
  oldVer: string;
  newVer: string;
  releaseLink?: string;
  status: 'updated' | 'pending' | 'failed' | 'error' | 'snoozed' | 'skipped' | 'maturity-blocked';
  updateKind: UpdateKind | null;
  running: boolean;
  registryError?: string;
  blocked: boolean;
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
