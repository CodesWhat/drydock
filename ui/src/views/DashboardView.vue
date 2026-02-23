<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { getAgents } from '../services/agent';
import { getAllContainers } from '../services/container';
import { getServer } from '../services/server';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';

const router = useRouter();

function navigateTo(route: RouteLocationRaw) {
  router.push(route);
}

const DASHBOARD_WIDGET_ORDER_STORAGE_KEY = 'dd-dashboard-widget-order-v1';
const DASHBOARD_WIDGET_IDS = [
  'recent-updates',
  'security-overview',
  'host-status',
  'update-breakdown',
] as const;
type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return (
    typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value)
  );
}

function sanitizeWidgetOrder(rawOrder: unknown): DashboardWidgetId[] {
  if (!Array.isArray(rawOrder)) {
    return [...DASHBOARD_WIDGET_IDS];
  }

  const seen = new Set<DashboardWidgetId>();
  const normalized: DashboardWidgetId[] = [];
  for (const value of rawOrder) {
    if (!isDashboardWidgetId(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  for (const id of DASHBOARD_WIDGET_IDS) {
    if (!seen.has(id)) {
      normalized.push(id);
    }
  }

  return normalized;
}

// Loading and error state
const loading = ref(true);
const error = ref<string | null>(null);

// Raw data from APIs
const containers = ref<Container[]>([]);
const serverInfo = ref<any>(null);
const agents = ref<any[]>([]);
const widgetOrder = ref<DashboardWidgetId[]>([...DASHBOARD_WIDGET_IDS]);
const draggedWidgetId = ref<DashboardWidgetId | null>(null);

function loadWidgetOrder() {
  const rawStored = localStorage.getItem(DASHBOARD_WIDGET_ORDER_STORAGE_KEY);
  if (!rawStored) {
    widgetOrder.value = [...DASHBOARD_WIDGET_IDS];
    return;
  }
  try {
    widgetOrder.value = sanitizeWidgetOrder(JSON.parse(rawStored));
  } catch {
    widgetOrder.value = [...DASHBOARD_WIDGET_IDS];
  }
}

function persistWidgetOrder(order: DashboardWidgetId[]) {
  localStorage.setItem(DASHBOARD_WIDGET_ORDER_STORAGE_KEY, JSON.stringify(order));
}

watch(widgetOrder, (order) => {
  persistWidgetOrder(order);
});

function widgetOrderIndex(widgetId: DashboardWidgetId) {
  const index = widgetOrder.value.indexOf(widgetId);
  return index >= 0 ? index : DASHBOARD_WIDGET_IDS.indexOf(widgetId);
}

function widgetOrderStyle(widgetId: DashboardWidgetId) {
  return {
    order: widgetOrderIndex(widgetId),
  };
}

function moveWidget(draggedId: DashboardWidgetId, targetId: DashboardWidgetId) {
  if (draggedId === targetId) {
    return;
  }

  const nextOrder = [...widgetOrder.value];
  const draggedIndex = nextOrder.indexOf(draggedId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return;
  }

  nextOrder.splice(draggedIndex, 1);
  nextOrder.splice(targetIndex, 0, draggedId);
  widgetOrder.value = nextOrder;
}

function onWidgetDragStart(widgetId: DashboardWidgetId, event: DragEvent) {
  draggedWidgetId.value = widgetId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', widgetId);
  }
}

function onWidgetDragOver(widgetId: DashboardWidgetId, event: DragEvent) {
  if (!draggedWidgetId.value || draggedWidgetId.value === widgetId) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onWidgetDrop(widgetId: DashboardWidgetId, event: DragEvent) {
  event.preventDefault();
  const transferWidgetId = event.dataTransfer?.getData('text/plain');
  const draggedId = isDashboardWidgetId(transferWidgetId)
    ? transferWidgetId
    : draggedWidgetId.value;
  if (!draggedId || draggedId === widgetId) {
    draggedWidgetId.value = null;
    return;
  }
  moveWidget(draggedId, widgetId);
  draggedWidgetId.value = null;
}

function onWidgetDragEnd() {
  draggedWidgetId.value = null;
}

function resetWidgetOrder() {
  widgetOrder.value = [...DASHBOARD_WIDGET_IDS];
}

async function fetchDashboardData() {
  loading.value = true;
  error.value = null;
  try {
    const [containersRes, serverRes, agentsRes] = await Promise.all([
      getAllContainers(),
      getServer().catch(() => null),
      getAgents().catch(() => []),
    ]);
    containers.value = mapApiContainers(containersRes);
    serverInfo.value = serverRes;
    agents.value = agentsRes;
  } catch (e: any) {
    error.value = e.message || 'Failed to load dashboard data';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  loadWidgetOrder();
  await fetchDashboardData();
});

// Computed: stat cards
const stats = computed(() => {
  const total = containers.value.length;
  const updatesAvailable = containers.value.filter((c) => c.updateKind).length;
  const securityIssues = containers.value.filter(
    (c) => c.bouncer === 'blocked' || c.bouncer === 'unsafe',
  ).length;
  const images = new Set(containers.value.map((c) => c.image)).size;
  return [
    {
      label: 'Containers',
      value: String(total),
      icon: 'containers',
      color: 'var(--dd-primary)',
      colorMuted: 'var(--dd-primary-muted)',
      route: '/containers',
    },
    {
      label: 'Updates Available',
      value: String(updatesAvailable),
      icon: 'updates',
      color: (() => {
        if (updatesAvailable === 0) return 'var(--dd-success)';
        const ratio = total > 0 ? updatesAvailable / total : 0;
        if (ratio >= 0.75) return 'var(--dd-danger)';
        if (ratio >= 0.5) return 'var(--dd-warning)';
        return 'var(--dd-caution)';
      })(),
      colorMuted: (() => {
        if (updatesAvailable === 0) return 'var(--dd-success-muted)';
        const ratio = total > 0 ? updatesAvailable / total : 0;
        if (ratio >= 0.75) return 'var(--dd-danger-muted)';
        if (ratio >= 0.5) return 'var(--dd-warning-muted)';
        return 'var(--dd-caution-muted)';
      })(),
      route: { path: '/containers', query: { filterKind: 'any' } },
    },
    {
      label: 'Security Issues',
      value: String(securityIssues),
      icon: 'security',
      color: securityIssues > 0 ? 'var(--dd-danger)' : 'var(--dd-success)',
      colorMuted: securityIssues > 0 ? 'var(--dd-danger-muted)' : 'var(--dd-success-muted)',
      route: '/security',
    },
    {
      label: 'Images',
      value: String(images),
      icon: 'images',
      color: 'var(--dd-primary)',
      colorMuted: 'var(--dd-primary-muted)',
    },
  ];
});

// Computed: recent updates (containers that have pending updates)
const recentUpdates = computed(() => {
  return containers.value
    .filter((c) => c.newTag)
    .slice(0, 6)
    .map((c) => ({
      name: c.name,
      image: c.image,
      icon: c.icon,
      oldVer: c.currentTag,
      newVer: c.newTag ?? '',
      status: 'pending' as const,
      running: c.status === 'running',
    }));
});

// Computed: security vulnerabilities (containers flagged by bouncer)
const vulnerabilities = computed(() => {
  return containers.value
    .filter((c) => c.bouncer === 'blocked' || c.bouncer === 'unsafe')
    .slice(0, 5)
    .map((c) => ({
      id: c.name,
      severity: c.bouncer === 'blocked' ? 'CRITICAL' : 'HIGH',
      package: c.image,
      image: c.name,
    }));
});

// Computed: servers list (local server + agents)
const servers = computed(() => {
  const list: Array<{
    name: string;
    status: 'connected' | 'disconnected';
    containers: { running: number; total: number };
  }> = [];

  // Local server is always present
  const localContainers = containers.value.filter((c) => c.server === 'Local');
  list.push({
    name: 'Local',
    status: 'connected',
    containers: {
      running: localContainers.filter((c) => c.status === 'running').length,
      total: localContainers.length,
    },
  });

  // Add agents as remote hosts
  for (const agent of agents.value) {
    const agentContainers = containers.value.filter((c) => c.server === agent.name);
    list.push({
      name: agent.name,
      status: agent.connected ? 'connected' : 'disconnected',
      containers: {
        running: agentContainers.filter((c) => c.status === 'running').length,
        total: agentContainers.length,
      },
    });
  }

  return list;
});

// Computed: security donut chart data
const securityCleanCount = computed(() => {
  return containers.value.filter((c) => c.bouncer === 'safe').length;
});
const securityIssueCount = computed(() => {
  return containers.value.filter((c) => c.bouncer === 'blocked' || c.bouncer === 'unsafe').length;
});
const securityTotalCount = computed(() => containers.value.length);
const DONUT_CIRCUMFERENCE = 301.6;

// Total containers with any update for breakdown bar scaling
const totalUpdates = computed(() => containers.value.filter((c) => c.updateKind).length);
</script>

<template>
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto pr-1 sm:pr-2">
      <!-- LOADING STATE -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <div class="text-sm dd-text-muted">Loading dashboard...</div>
      </div>

      <!-- ERROR STATE -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-16">
        <div class="text-sm font-medium dd-text-danger mb-2">Failed to load dashboard</div>
        <div class="text-xs dd-text-muted">{{ error }}</div>
        <button
          class="mt-4 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
          @click="fetchDashboardData">
          Retry
        </button>
      </div>

      <template v-else>
      <!-- STAT CARDS -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <component
          :is="stat.route ? 'button' : 'div'"
          v-for="stat in stats"
          :key="stat.label"
          :type="stat.route ? 'button' : undefined"
          class="stat-card dd-rounded p-4 text-left w-full"
          :class="stat.route ? 'cursor-pointer transition-colors hover:dd-bg-elevated' : ''"
          :style="{
            backgroundColor: 'var(--dd-bg-card)',
            borderTop: '1px solid var(--dd-border-strong)',
            borderRight: '1px solid var(--dd-border-strong)',
            borderBottom: '1px solid var(--dd-border-strong)',
            borderLeft: `4px solid ${stat.color}`,
          }"
          @click="stat.route && navigateTo(stat.route)">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium uppercase tracking-wider dd-text-muted">
              {{ stat.label }}
            </span>
            <div class="w-9 h-9 dd-rounded flex items-center justify-center"
                 :style="{ backgroundColor: stat.colorMuted, color: stat.color }">
              <AppIcon :name="stat.icon" :size="20" />
            </div>
          </div>
          <div class="text-2xl font-bold dd-text">
            {{ stat.value }}
          </div>
        </component>
      </div>

      <div class="mb-3 flex items-center justify-between px-1 text-[10px] dd-text-muted">
        <span>Drag dashboard widgets to reorder your layout</span>
        <button
          data-testid="dashboard-reset-layout"
          class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
          @click="resetWidgetOrder">
          Reset layout
        </button>
      </div>

      <!-- WIDGET GRID -->
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 min-w-0">

        <!-- Recent Updates Widget (2/3) -->
        <div
             data-widget-id="recent-updates"
             :data-widget-order="widgetOrderIndex('recent-updates')"
             draggable="true"
             class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden min-w-0"
             :class="{ 'opacity-60': draggedWidgetId === 'recent-updates' }"
             :style="{
               ...widgetOrderStyle('recent-updates'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('recent-updates', $event)"
             @dragover="onWidgetDragOver('recent-updates', $event)"
             @drop="onWidgetDrop('recent-updates', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-xs font-semibold dd-text">
                Recent Updates
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo({ path: '/containers', query: { filterKind: 'any' } })">View all &rarr;</button>
          </div>

          <div>
            <table class="w-full text-xs table-fixed">
              <thead>
                <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <th class="w-10 px-0 py-2.5" />
                  <th class="text-left px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Container</th>
                  <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Version</th>
                  <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Status</th>
                </tr>
              </thead>
            </table>
            <div class="sm:overflow-y-auto sm:max-h-[340px]">
            <table class="w-full text-xs table-fixed">
              <tbody>
                <tr v-for="(row, i) in recentUpdates" :key="i"
                    class="transition-colors hover:dd-bg-elevated"
                    :style="{ borderBottom: i < recentUpdates.length - 1 ? '1px solid var(--dd-border-strong)' : 'none' }">
                  <td class="w-12 px-0 py-3">
                    <div class="flex items-center justify-center">
                      <ContainerIcon :icon="row.icon" :size="28" />
                    </div>
                  </td>
                  <td class="px-3 py-3 align-middle">
                    <div class="font-medium dd-text leading-tight">{{ row.name }}</div>
                    <div class="text-[10px] dd-text-muted mt-0.5 truncate">{{ row.image }}</div>
                  </td>
                  <td class="px-5 py-3 align-middle overflow-hidden">
                    <div class="grid items-center gap-1.5 min-w-0" style="grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);">
                      <span class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium text-right justify-self-end dd-bg-elevated dd-text-secondary truncate max-w-full">
                        {{ row.oldVer }}
                      </span>
                      <AppIcon name="arrow-right" :size="8" class="justify-self-center dd-text-muted shrink-0" />
                      <span class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium justify-self-start truncate max-w-full"
                            style="background: var(--dd-primary-muted); color: var(--dd-primary);">
                        {{ row.newVer }}
                      </span>
                    </div>
                  </td>
                  <td class="px-5 py-3 text-center align-middle">
                    <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                          :style="{
                            backgroundColor: row.status === 'updated'
                              ? 'var(--dd-success-muted)'
                              : row.status === 'pending'
                                ? 'var(--dd-warning-muted)'
                                : 'var(--dd-danger-muted)',
                            color: row.status === 'updated' ? 'var(--dd-success)' : row.status === 'pending' ? 'var(--dd-warning)' : 'var(--dd-danger)',
                          }">
                      <AppIcon :name="row.status === 'updated' ? 'check' : row.status === 'pending' ? 'pending' : 'xmark'" :size="12" />
                    </span>
                    <span class="badge max-md:!hidden"
                          :style="{
                            backgroundColor: row.status === 'updated'
                              ? 'var(--dd-success-muted)'
                              : row.status === 'pending'
                                ? 'var(--dd-warning-muted)'
                                : 'var(--dd-danger-muted)',
                            color: row.status === 'updated' ? 'var(--dd-success)' : row.status === 'pending' ? 'var(--dd-warning)' : 'var(--dd-danger)',
                          }">
                      <AppIcon :name="row.status === 'updated' ? 'check' : row.status === 'pending' ? 'pending' : 'xmark'"
                         :size="12" class="mr-1" />
                      {{ row.status }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <!-- Security Summary Widget (1/3) -->
        <div
             data-widget-id="security-overview"
             :data-widget-order="widgetOrderIndex('security-overview')"
             draggable="true"
             class="dashboard-widget dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'security-overview' }"
             :style="{
               ...widgetOrderStyle('security-overview'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('security-overview', $event)"
             @dragover="onWidgetDragOver('security-overview', $event)"
             @drop="onWidgetDrop('security-overview', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="security" :size="14" class="text-drydock-accent" />
              <h2 class="text-xs font-semibold dd-text">
                Security Overview
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo('/security')">View all &rarr;</button>
          </div>

          <div class="p-5">
            <!-- Donut chart -->
            <div class="flex items-center justify-center mb-5">
              <div class="relative" style="width: 140px; height: 140px;">
                <svg viewBox="0 0 120 120" class="w-full h-full" style="transform: rotate(-90deg);">
                  <circle cx="60" cy="60" r="48" fill="none"
                          stroke="var(--dd-border-strong)" stroke-width="14" />
                  <circle cx="60" cy="60" r="48" fill="none" stroke="var(--dd-success)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="(securityTotalCount > 0 ? securityCleanCount / securityTotalCount * DONUT_CIRCUMFERENCE : 0) + ' ' + DONUT_CIRCUMFERENCE" />
                  <circle v-if="securityIssueCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-danger)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="(securityTotalCount > 0 ? securityIssueCount / securityTotalCount * DONUT_CIRCUMFERENCE : 0) + ' ' + DONUT_CIRCUMFERENCE"
                          :stroke-dashoffset="-(securityTotalCount > 0 ? securityCleanCount / securityTotalCount * DONUT_CIRCUMFERENCE : 0)" />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-xl font-bold dd-text">{{ securityTotalCount }}</span>
                  <span class="text-[10px] dd-text-muted">images</span>
                </div>
              </div>
            </div>

            <!-- Legend -->
            <div class="flex justify-center gap-5 mb-5">
              <div class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-success);" />
                <span class="text-[11px] dd-text-secondary">{{ securityCleanCount }} Clean</span>
              </div>
              <div v-if="securityIssueCount > 0" class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-danger);" />
                <span class="text-[11px] dd-text-secondary">{{ securityIssueCount }} Issues</span>
              </div>
            </div>

            <div class="mb-4" :style="{ borderTop: '1px solid var(--dd-border-strong)' }" />

            <!-- Top vulnerabilities -->
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-3 dd-text-muted">
              Top Vulnerabilities
            </div>
            <div class="space-y-2.5">
              <div v-for="vuln in vulnerabilities" :key="vuln.id"
                   class="flex items-start gap-3 p-2.5 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="shrink-0 mt-0.5">
                  <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                        :style="{
                          backgroundColor: vuln.severity === 'CRITICAL'
                            ? 'var(--dd-danger-muted)'
                            : 'var(--dd-warning-muted)',
                          color: vuln.severity === 'CRITICAL' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                        }">
                    <AppIcon :name="vuln.severity === 'CRITICAL' ? 'warning' : 'chevrons-up'" :size="12" />
                  </span>
                  <span class="badge text-[9px] max-md:!hidden"
                        :style="{
                          backgroundColor: vuln.severity === 'CRITICAL'
                            ? 'var(--dd-danger-muted)'
                            : 'var(--dd-warning-muted)',
                          color: vuln.severity === 'CRITICAL' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                        }">
                    {{ vuln.severity }}
                  </span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] font-semibold truncate dd-text">
                    {{ vuln.id }}
                  </div>
                  <div class="text-[10px] mt-0.5 truncate dd-text-muted">
                    {{ vuln.package }} &middot; {{ vuln.image }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Host Status Widget (1/3) -->
        <div
             data-widget-id="host-status"
             :data-widget-order="widgetOrderIndex('host-status')"
             draggable="true"
             class="dashboard-widget dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'host-status' }"
             :style="{
               ...widgetOrderStyle('host-status'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('host-status', $event)"
             @dragover="onWidgetDragOver('host-status', $event)"
             @drop="onWidgetDrop('host-status', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="servers" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Host Status
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo('/servers')">View all &rarr;</button>
          </div>

          <div class="p-4 space-y-3">
            <div v-for="server in servers" :key="server.name"
                 class="flex items-center gap-3 p-3 dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <span class="badge px-1.5 py-0 text-[9px] max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-[12px] font-semibold truncate dd-text">{{ server.name }}</div>
                <div class="text-[10px] dd-text-muted">{{ server.containers.running }}/{{ server.containers.total }} containers</div>
              </div>
              <span class="badge px-1.5 py-0 text-[9px] md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <span class="badge text-[9px] uppercase font-bold max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                {{ server.status }}
              </span>
            </div>
          </div>
        </div>

        <!-- Update Breakdown Widget (2/3) -->
        <div
             data-widget-id="update-breakdown"
             :data-widget-order="widgetOrderIndex('update-breakdown')"
             draggable="true"
             class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'update-breakdown' }"
             :style="{
               ...widgetOrderStyle('update-breakdown'),
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }"
             @dragstart="onWidgetDragStart('update-breakdown', $event)"
             @dragover="onWidgetDragOver('update-breakdown', $event)"
             @drop="onWidgetDrop('update-breakdown', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Update Breakdown
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo({ path: '/containers', query: { filterKind: 'any' } })">View all &rarr;</button>
          </div>

          <div class="p-5">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div v-for="kind in [
                { label: 'Major', count: containers.filter(c => c.updateKind === 'major').length, color: 'var(--dd-danger)', colorMuted: 'var(--dd-danger-muted)', icon: 'chevrons-up' },
                { label: 'Minor', count: containers.filter(c => c.updateKind === 'minor').length, color: 'var(--dd-warning)', colorMuted: 'var(--dd-warning-muted)', icon: 'chevron-up' },
                { label: 'Patch', count: containers.filter(c => c.updateKind === 'patch').length, color: 'var(--dd-primary)', colorMuted: 'var(--dd-primary-muted)', icon: 'hashtag' },
                { label: 'Digest', count: containers.filter(c => c.updateKind === 'digest').length, color: 'var(--dd-neutral)', colorMuted: 'var(--dd-neutral-muted)', icon: 'fingerprint' },
              ]" :key="kind.label"
                   class="text-center p-3 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="w-9 h-9 mx-auto dd-rounded flex items-center justify-center mb-2"
                     :style="{ backgroundColor: kind.colorMuted, color: kind.color }">
                  <AppIcon :name="kind.icon" :size="20" />
                </div>
                <div class="text-xl font-bold dd-text">{{ kind.count }}</div>
                <div class="text-[10px] font-medium uppercase tracking-wider mt-0.5 dd-text-muted">{{ kind.label }}</div>
                <!-- Mini bar -->
                <div class="mt-2 h-1.5 dd-rounded-sm overflow-hidden" style="background: var(--dd-bg-elevated);">
                  <div class="h-full dd-rounded-sm transition-all"
                       :style="{ width: Math.max(kind.count / Math.max(totalUpdates, 1) * 100, 4) + '%', backgroundColor: kind.color }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </template>
  </div>
</template>
