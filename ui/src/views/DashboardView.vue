<script setup lang="ts">
import { computed, ref } from 'vue';
import { type RouteLocationRaw, useRouter } from 'vue-router';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { ROUTES } from '../router/routes';
import { updateContainer } from '../services/container-actions';
import { useDashboardComputed } from './dashboard/useDashboardComputed';
import { useDashboardData } from './dashboard/useDashboardData';
import { useDashboardWidgetOrder } from './dashboard/useDashboardWidgetOrder';

const router = useRouter();
const confirm = useConfirmDialog();
const dashboardUpdateInProgress = ref<string | null>(null);
const dashboardUpdateAllInProgress = ref(false);

function navigateTo(route: RouteLocationRaw) {
  router.push(route);
}

const {
  draggedWidgetId,
  onWidgetDragEnd,
  onWidgetDragOver,
  onWidgetDragStart,
  onWidgetDrop,
  widgetOrderIndex,
  widgetOrderStyle,
} = useDashboardWidgetOrder();

const {
  agents,
  containerSummary,
  containers,
  error,
  fetchDashboardData,
  loading,
  maintenanceCountdownNow,
  recentStatusByContainer,
  registries,
  serverInfo,
  watchers,
} = useDashboardData();

const {
  DONUT_CIRCUMFERENCE,
  getUpdateKindColor,
  getUpdateKindIcon,
  getUpdateKindMutedColor,
  recentUpdates,
  securityCleanArcLength,
  securityCleanCount,
  securityIssueArcLength,
  securityIssueCount,
  securityNotScannedArcLength,
  securityNotScannedCount,
  securitySeverityTotals,
  securityTotalCount,
  servers,
  showSecuritySeverityBreakdown,
  stats,
  totalUpdates,
  updateBreakdownBuckets,
  vulnerabilities,
} = useDashboardComputed({
  agents,
  containerSummary,
  containers,
  maintenanceCountdownNow,
  recentStatusByContainer,
  registries,
  serverInfo,
  watchers,
});

const pendingUpdates = computed(() => recentUpdates.value.filter((r) => r.status === 'pending'));

function confirmDashboardUpdate(row: { id: string; name: string }) {
  confirm.require({
    header: 'Update Container',
    message: `Update ${row.name} now? This will apply the latest discovered image.`,
    severity: 'warn',
    acceptLabel: 'Update',
    rejectLabel: 'Cancel',
    accept: async () => {
      dashboardUpdateInProgress.value = row.id;
      try {
        await updateContainer(row.id);
        await fetchDashboardData();
      } finally {
        dashboardUpdateInProgress.value = null;
      }
    },
  });
}

function confirmDashboardUpdateAll() {
  confirm.require({
    header: 'Update All Containers',
    message: `${pendingUpdates.value.length} containers will be updated. Continue?`,
    severity: 'warn',
    acceptLabel: 'Update All',
    rejectLabel: 'Cancel',
    accept: async () => {
      dashboardUpdateAllInProgress.value = true;
      try {
        for (const row of pendingUpdates.value) {
          await updateContainer(row.id);
        }
        await fetchDashboardData();
      } finally {
        dashboardUpdateAllInProgress.value = false;
      }
    },
  });
}
</script>

<template>
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto pr-2 sm:pr-[15px]">
      <!-- LOADING STATE -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <div class="text-sm dd-text-muted">Loading dashboard...</div>
      </div>

      <!-- ERROR STATE -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-16">
        <div class="text-sm font-medium dd-text-danger mb-2">Failed to load dashboard</div>
        <div class="text-xs dd-text-muted">{{ error }}</div>
        <button
          class="mt-4 px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
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
          :key="stat.id"
          :data-widget-id="stat.id"
          :data-widget-order="widgetOrderIndex(stat.id)"
          draggable="true"
          :aria-label="stat.label + ': ' + stat.value"
          :type="stat.route ? 'button' : undefined"
          class="stat-card dd-rounded p-4 text-left w-full"
          :class="[
            stat.route ? 'cursor-pointer transition-colors hover:dd-bg-elevated' : '',
            { 'opacity-60': draggedWidgetId === stat.id },
          ]"
          :style="{
            ...widgetOrderStyle(stat.id),
            backgroundColor: 'var(--dd-bg-card)',
          }"
          @click="stat.route && navigateTo(stat.route)"
          @dragstart="onWidgetDragStart(stat.id, $event)"
          @dragover="onWidgetDragOver(stat.id, $event)"
          @drop="onWidgetDrop(stat.id, $event)"
          @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[0.6875rem] font-medium uppercase tracking-wider dd-text-muted">
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
          <div v-if="stat.detail" class="mt-1 text-[0.625rem] font-medium dd-text-muted">
            {{ stat.detail }}
          </div>
        </component>
      </div>

      <!-- WIDGET GRID -->
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 min-w-0">

        <!-- Recent Updates Widget (2/3) -->
        <div
             data-widget-id="recent-updates"
             :data-widget-order="widgetOrderIndex('recent-updates')"
             draggable="true"
             aria-label="Updates Available widget"
             class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden min-w-0 flex flex-col"
             :class="{ 'opacity-60': draggedWidgetId === 'recent-updates' }"
             :style="{
               ...widgetOrderStyle('recent-updates'),
               backgroundColor: 'var(--dd-bg-card)',
             }"
             @dragstart="onWidgetDragStart('recent-updates', $event)"
             @dragover="onWidgetDragOver('recent-updates', $event)"
             @drop="onWidgetDrop('recent-updates', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-xs font-semibold dd-text">
                Updates Available
              </h2>
            </div>
            <div class="flex items-center">
              <button class="text-[0.6875rem] font-medium text-drydock-secondary hover:underline"
                      @click="navigateTo({ path: ROUTES.CONTAINERS, query: { filterKind: 'any' } })">View all &rarr;</button>
              <button v-if="pendingUpdates.length > 0"
                      data-test="dashboard-update-all-btn"
                      class="text-[0.6875rem] font-medium text-drydock-secondary hover:underline ml-3"
                      :disabled="dashboardUpdateAllInProgress"
                      @click="confirmDashboardUpdateAll()">
                Update All ({{ pendingUpdates.length }})
              </button>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto">
          <DataTable
            :columns="[
              { key: 'icon', label: '', icon: true },
              { key: 'container', label: 'Container', sortable: false },
              { key: 'version', label: 'Version', sortable: false, align: 'text-center' },
              { key: 'type', label: 'Type', sortable: false },
              { key: 'actions', label: '', sortable: false },
            ]"
            :rows="recentUpdates"
            row-key="id"
            compact
          >
            <template #cell-icon="{ row }">
              <ContainerIcon :icon="row.icon" :size="28" />
            </template>

            <template #cell-container="{ row }">
              <div class="font-medium dd-text leading-tight">{{ row.name }}</div>
              <div class="text-[0.625rem] dd-text-muted mt-0.5 truncate">{{ row.image }}</div>
              <div v-if="row.registryError" class="text-[0.625rem] mt-0.5 truncate" style="color: var(--dd-danger);">
                {{ row.registryError }}
              </div>
              <a
                v-if="row.releaseLink"
                :href="row.releaseLink"
                target="_blank"
                rel="noopener noreferrer"
                class="text-[0.625rem] mt-0.5 inline-flex underline hover:no-underline"
                style="color: var(--dd-info);"
              >
                Release notes
              </a>
            </template>

            <template #cell-version="{ row }">
              <!-- Desktop: horizontal old → new -->
              <div class="hidden sm:flex items-center justify-center gap-1.5 min-w-0">
                <CopyableTag :tag="row.oldVer" class="text-[0.6875rem] dd-text-secondary truncate max-w-[100px]">
                  {{ row.oldVer }}
                </CopyableTag>
                <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
                <CopyableTag :tag="row.newVer" class="text-[0.6875rem] font-semibold truncate max-w-[120px]"
                      :style="{ color: getUpdateKindColor(row.updateKind) }">
                  {{ row.newVer }}
                </CopyableTag>
              </div>
              <!-- Mobile: stacked old ↓ new -->
              <div class="flex sm:hidden flex-col items-start gap-0.5 min-w-0">
                <CopyableTag :tag="row.oldVer" class="text-[0.5625rem] dd-text-secondary break-all leading-tight">
                  {{ row.oldVer }}
                </CopyableTag>
                <CopyableTag :tag="row.newVer" class="text-[0.5625rem] font-semibold break-all leading-tight"
                      :style="{ color: getUpdateKindColor(row.updateKind) }">
                  {{ row.newVer }}
                </CopyableTag>
              </div>
            </template>

            <template #cell-type="{ row }">
              <!-- Mobile: icon-only badge -->
              <span class="badge px-1.5 py-0 text-[0.5625rem] sm:!hidden"
                    :style="{
                      backgroundColor: getUpdateKindMutedColor(row.updateKind),
                      color: getUpdateKindColor(row.updateKind),
                    }">
                <AppIcon :name="getUpdateKindIcon(row.updateKind)" :size="12" />
              </span>
              <!-- Desktop: icon + text badge -->
              <span class="badge max-sm:!hidden"
                    :style="{
                      backgroundColor: getUpdateKindMutedColor(row.updateKind),
                      color: getUpdateKindColor(row.updateKind),
                    }">
                <AppIcon :name="getUpdateKindIcon(row.updateKind)"
                   :size="12" class="mr-1" />
                {{ row.updateKind ?? 'unknown' }}
              </span>
            </template>

            <template #cell-actions="{ row }">
              <button v-if="row.status === 'pending'"
                      data-test="dashboard-update-btn"
                      class="p-1 dd-rounded transition-colors hover:dd-bg-elevated"
                      :disabled="dashboardUpdateInProgress === row.id || dashboardUpdateAllInProgress"
                      @click.stop="confirmDashboardUpdate(row)">
                <AppIcon name="update" :size="12" class="text-drydock-secondary" />
              </button>
            </template>

            <template #empty>
              <div class="px-4 py-6 text-center text-[0.6875rem] dd-text-muted">
                No updates available
              </div>
            </template>
          </DataTable>
          </div>
        </div>

        <!-- Security Summary Widget (1/3) -->
        <div
             data-widget-id="security-overview"
             :data-widget-order="widgetOrderIndex('security-overview')"
             draggable="true"
             aria-label="Security Overview widget"
             class="dashboard-widget dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'security-overview' }"
             :style="{
               ...widgetOrderStyle('security-overview'),
               backgroundColor: 'var(--dd-bg-card)',
             }"
             @dragstart="onWidgetDragStart('security-overview', $event)"
             @dragover="onWidgetDragOver('security-overview', $event)"
             @drop="onWidgetDrop('security-overview', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="security" :size="14" class="text-drydock-accent" />
              <h2 class="text-xs font-semibold dd-text">
                Security Overview
              </h2>
            </div>
            <button class="text-[0.6875rem] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo(ROUTES.SECURITY)">View all &rarr;</button>
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
                          :stroke-dasharray="securityCleanArcLength + ' ' + DONUT_CIRCUMFERENCE" />
                  <circle v-if="securityIssueCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-danger)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="securityIssueArcLength + ' ' + DONUT_CIRCUMFERENCE"
                          :stroke-dashoffset="-securityCleanArcLength" />
                  <circle v-if="securityNotScannedCount > 0" cx="60" cy="60" r="48" fill="none" stroke="var(--dd-neutral)" stroke-width="14"
                          stroke-linecap="round" class="donut-ring"
                          :stroke-dasharray="securityNotScannedArcLength + ' ' + DONUT_CIRCUMFERENCE"
                          :stroke-dashoffset="-(securityCleanArcLength + securityIssueArcLength)" />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-xl font-bold dd-text">{{ securityTotalCount }}</span>
                  <span class="text-[0.625rem] dd-text-muted">images</span>
                </div>
              </div>
            </div>

            <!-- Legend -->
            <div class="flex justify-center gap-5 mb-5">
              <div class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-success);" />
                <span class="text-[0.6875rem] dd-text-secondary">{{ securityCleanCount }} Clean</span>
              </div>
              <div v-if="securityIssueCount > 0" class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-danger);" />
                <span class="text-[0.6875rem] dd-text-secondary">{{ securityIssueCount }} Issues</span>
              </div>
              <div v-if="securityNotScannedCount > 0" class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-neutral);" />
                <span class="text-[0.6875rem] dd-text-secondary">
                  {{ securityNotScannedCount }} Not Scanned
                </span>
              </div>
            </div>

            <div v-if="showSecuritySeverityBreakdown"
                 data-test="security-severity-breakdown"
                 class="mb-5">
              <div class="text-[0.625rem] font-semibold uppercase tracking-wider mb-2 dd-text-muted">
                Severity Breakdown
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
                  <span class="text-[0.625rem] font-semibold" style="color: var(--dd-danger);">
                    {{ securitySeverityTotals.critical }} Critical
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-warning-muted)' }">
                  <span class="text-[0.625rem] font-semibold" style="color: var(--dd-warning);">
                    {{ securitySeverityTotals.high }} High
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-caution-muted)' }">
                  <span class="text-[0.625rem] font-semibold" style="color: var(--dd-caution);">
                    {{ securitySeverityTotals.medium }} Medium
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-info-muted)' }">
                  <span class="text-[0.625rem] font-semibold" style="color: var(--dd-info);">
                    {{ securitySeverityTotals.low }} Low
                  </span>
                </div>
              </div>
            </div>

            <div class="mb-4" :style="{ borderTop: '1px solid var(--dd-border)' }" />

            <!-- Top vulnerabilities -->
            <div class="text-[0.625rem] font-semibold uppercase tracking-wider mb-3 dd-text-muted">
              Top Vulnerabilities
            </div>
            <div class="space-y-2.5 overflow-y-auto max-h-[200px]">
              <div v-for="vuln in vulnerabilities" :key="vuln.id"
                   class="flex items-start gap-3 p-2.5 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="shrink-0 mt-0.5">
                  <span class="badge px-1.5 py-0 text-[0.5625rem] md:!hidden"
                        :style="{
                          backgroundColor: vuln.severity === 'CRITICAL'
                            ? 'var(--dd-danger-muted)'
                            : 'var(--dd-warning-muted)',
                          color: vuln.severity === 'CRITICAL' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                        }">
                    <AppIcon :name="vuln.severity === 'CRITICAL' ? 'warning' : 'chevrons-up'" :size="12" />
                  </span>
                  <span class="badge text-[0.5625rem] max-md:!hidden"
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
                  <div class="text-[0.6875rem] font-semibold truncate dd-text">
                    {{ vuln.id }}
                  </div>
                  <div class="text-[0.625rem] mt-0.5 truncate dd-text-muted">
                    {{ vuln.package }} &middot; {{ vuln.image }}
                  </div>
                </div>
              </div>
              <div v-if="vulnerabilities.length === 0"
                   class="p-2.5 dd-rounded text-[0.6875rem] text-center dd-text-muted"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                No vulnerabilities reported
              </div>
            </div>
          </div>
        </div>

        <!-- Host Status Widget (1/3) -->
        <div
             data-widget-id="host-status"
             :data-widget-order="widgetOrderIndex('host-status')"
             draggable="true"
             aria-label="Host Status widget"
             class="dashboard-widget dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'host-status' }"
             :style="{
               ...widgetOrderStyle('host-status'),
               backgroundColor: 'var(--dd-bg-card)',
             }"
             @dragstart="onWidgetDragStart('host-status', $event)"
             @dragover="onWidgetDragOver('host-status', $event)"
             @drop="onWidgetDrop('host-status', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="servers" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Host Status
              </h2>
            </div>
            <button class="text-[0.6875rem] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo(ROUTES.SERVERS)">View all &rarr;</button>
          </div>

          <div class="p-4 space-y-3">
            <div v-for="server in servers" :key="server.name"
                 class="flex items-center gap-3 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
                 @click="navigateTo(ROUTES.SERVERS)">
              <span class="badge px-1.5 py-0 text-[0.5625rem] max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-semibold truncate dd-text">{{ server.name }}</div>
                <div v-if="server.host" class="text-[0.625rem] font-mono dd-text-muted truncate mt-0.5">
                  {{ server.host }}
                </div>
                <div class="text-[0.625rem] dd-text-muted">{{ server.containers.running }}/{{ server.containers.total }} containers</div>
              </div>
              <span class="badge px-1.5 py-0 text-[0.5625rem] md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <span class="badge text-[0.5625rem] uppercase font-bold max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                {{ server.statusLabel ?? server.status }}
              </span>
            </div>
          </div>
        </div>

        <!-- Update Breakdown Widget (2/3) -->
        <div
             data-widget-id="update-breakdown"
             :data-widget-order="widgetOrderIndex('update-breakdown')"
             draggable="true"
             aria-label="Update Breakdown widget"
             class="dashboard-widget xl:col-span-2 dd-rounded overflow-hidden"
             :class="{ 'opacity-60': draggedWidgetId === 'update-breakdown' }"
             :style="{
               ...widgetOrderStyle('update-breakdown'),
               backgroundColor: 'var(--dd-bg-card)',
             }"
             @dragstart="onWidgetDragStart('update-breakdown', $event)"
             @dragover="onWidgetDragOver('update-breakdown', $event)"
             @drop="onWidgetDrop('update-breakdown', $event)"
             @dragend="onWidgetDragEnd">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Update Breakdown
              </h2>
            </div>
            <button class="text-[0.6875rem] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo({ path: ROUTES.CONTAINERS, query: { filterKind: 'any' } })">View all &rarr;</button>
          </div>

          <div class="p-5">
            <div v-if="totalUpdates === 0"
                 class="p-3 dd-rounded text-[0.6875rem] text-center dd-text-muted"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              No updates to categorize
            </div>
            <div v-else class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div v-for="kind in updateBreakdownBuckets" :key="kind.label"
                   class="text-center p-3 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="w-9 h-9 mx-auto dd-rounded flex items-center justify-center mb-2"
                     :style="{ backgroundColor: kind.colorMuted, color: kind.color }">
                  <AppIcon :name="kind.icon" :size="20" />
                </div>
                <div class="text-xl font-bold dd-text">{{ kind.count }}</div>
                <div class="text-[0.625rem] font-medium uppercase tracking-wider mt-0.5 dd-text-muted">{{ kind.label }}</div>
                <!-- Mini bar -->
                <div class="mt-2 h-1.5 dd-rounded-sm overflow-hidden" style="background: var(--dd-bg-elevated);">
                  <div class="h-full dd-rounded-sm transition-[color,background-color,border-color,opacity,transform,box-shadow]"
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
