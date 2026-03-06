<script setup lang="ts">
import { type RouteLocationRaw, useRouter } from 'vue-router';
import { useDashboardComputed } from './dashboard/useDashboardComputed';
import { useDashboardData } from './dashboard/useDashboardData';
import { useDashboardWidgetOrder } from './dashboard/useDashboardWidgetOrder';

const router = useRouter();

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
            borderTop: '1px solid var(--dd-border-strong)',
            borderRight: '1px solid var(--dd-border-strong)',
            borderBottom: '1px solid var(--dd-border-strong)',
            borderLeft: `4px solid ${stat.color}`,
          }"
          @click="stat.route && navigateTo(stat.route)"
          @dragstart="onWidgetDragStart(stat.id, $event)"
          @dragover="onWidgetDragOver(stat.id, $event)"
          @drop="onWidgetDrop(stat.id, $event)"
          @dragend="onWidgetDragEnd">
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
          <div v-if="stat.detail" class="mt-1 text-[10px] font-medium dd-text-muted">
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
                Updates Available
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo({ path: '/containers', query: { filterKind: 'any' } })">View all &rarr;</button>
          </div>

          <div>
            <table class="w-full text-xs table-fixed">
              <colgroup>
                <col class="w-12" />
                <col />
                <col />
                <col class="w-16 sm:w-24" />
              </colgroup>
              <thead>
                <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <th class="px-0 py-2.5" />
                  <th class="text-left px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Container</th>
                  <th class="text-left px-2 sm:px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Version</th>
                  <th class="text-center px-1 sm:px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">
                    <span class="hidden sm:inline">Type</span>
                    <span class="sm:hidden inline-flex items-center justify-center"><AppIcon name="info" :size="12" /></span>
                  </th>
                </tr>
              </thead>
            </table>
            <div class="sm:overflow-y-auto sm:max-h-[340px]">
            <table class="w-full text-xs table-fixed">
              <colgroup>
                <col class="w-12" />
                <col />
                <col />
                <col class="w-16 sm:w-24" />
              </colgroup>
              <tbody>
                <tr v-for="(row, i) in recentUpdates" :key="row.id"
                    :data-update-status="row.status"
                    class="transition-colors hover:dd-bg-elevated"
                    :style="{ borderBottom: i < recentUpdates.length - 1 ? '1px solid var(--dd-border-strong)' : 'none' }">
                  <td class="px-0 py-3">
                    <div class="flex items-center justify-center">
                      <ContainerIcon :icon="row.icon" :size="28" />
                    </div>
                  </td>
                  <td class="px-3 py-3 align-middle">
                    <div class="font-medium dd-text leading-tight">{{ row.name }}</div>
                    <div class="text-[10px] dd-text-muted mt-0.5 truncate">{{ row.image }}</div>
                    <div v-if="row.registryError" class="text-[10px] mt-0.5 truncate" style="color: var(--dd-danger);">
                      {{ row.registryError }}
                    </div>
                    <a
                      v-if="row.releaseLink"
                      :href="row.releaseLink"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[10px] mt-0.5 inline-flex underline hover:no-underline"
                      style="color: var(--dd-info);"
                    >
                      Release notes
                    </a>
                  </td>
                  <td class="px-2 sm:px-5 py-3 align-middle overflow-hidden">
                    <!-- Desktop: horizontal old → new -->
                    <div class="hidden sm:flex items-center justify-center gap-1.5 min-w-0">
                      <span class="text-[11px] dd-text-secondary truncate max-w-[100px]" v-tooltip.top="row.oldVer">
                        {{ row.oldVer }}
                      </span>
                      <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
                      <span class="text-[11px] font-semibold truncate max-w-[120px]"
                            :style="{ color: getUpdateKindColor(row.updateKind) }">
                        {{ row.newVer }}
                      </span>
                    </div>
                    <!-- Mobile: stacked old ↓ new -->
                    <div class="flex sm:hidden flex-col items-start gap-0.5 min-w-0">
                      <span class="text-[9px] dd-text-secondary break-all leading-tight">
                        {{ row.oldVer }}
                      </span>
                      <span class="text-[9px] font-semibold break-all leading-tight"
                            :style="{ color: getUpdateKindColor(row.updateKind) }">
                        {{ row.newVer }}
                      </span>
                    </div>
                  </td>
                  <td class="px-1 sm:px-3 py-3 text-center align-middle">
                    <span class="badge px-1.5 py-0 text-[9px] sm:!hidden"
                          :style="{
                            backgroundColor: getUpdateKindMutedColor(row.updateKind),
                            color: getUpdateKindColor(row.updateKind),
                          }">
                      <AppIcon :name="getUpdateKindIcon(row.updateKind)" :size="12" />
                    </span>
                    <span class="badge max-sm:!hidden"
                          :style="{
                            backgroundColor: getUpdateKindMutedColor(row.updateKind),
                            color: getUpdateKindColor(row.updateKind),
                          }">
                      <AppIcon :name="getUpdateKindIcon(row.updateKind)"
                         :size="12" class="mr-1" />
                      {{ row.updateKind ?? 'unknown' }}
                    </span>
                  </td>
                </tr>
                <tr v-if="recentUpdates.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-[11px] dd-text-muted">
                    No updates available
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
             aria-label="Security Overview widget"
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
              <div v-if="securityNotScannedCount > 0" class="flex items-center gap-1.5">
                <div class="w-2.5 h-2.5 rounded-full" style="background:var(--dd-neutral);" />
                <span class="text-[11px] dd-text-secondary">
                  {{ securityNotScannedCount }} Not Scanned
                </span>
              </div>
            </div>

            <div v-if="showSecuritySeverityBreakdown"
                 data-test="security-severity-breakdown"
                 class="mb-5">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">
                Severity Breakdown
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-danger);">
                    {{ securitySeverityTotals.critical }} Critical
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-warning-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-warning);">
                    {{ securitySeverityTotals.high }} High
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-caution-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-caution);">
                    {{ securitySeverityTotals.medium }} Medium
                  </span>
                </div>
                <div class="flex items-center justify-between px-2 py-1.5 dd-rounded"
                     :style="{ backgroundColor: 'var(--dd-info-muted)' }">
                  <span class="text-[10px] font-semibold" style="color: var(--dd-info);">
                    {{ securitySeverityTotals.low }} Low
                  </span>
                </div>
              </div>
            </div>

            <div class="mb-4" :style="{ borderTop: '1px solid var(--dd-border-strong)' }" />

            <!-- Top vulnerabilities -->
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-3 dd-text-muted">
              Top Vulnerabilities
            </div>
            <div class="space-y-2.5 overflow-y-auto max-h-[200px]">
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
              <div v-if="vulnerabilities.length === 0"
                   class="p-2.5 dd-rounded text-[11px] text-center dd-text-muted"
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
                 class="flex items-center gap-3 p-3 dd-rounded cursor-pointer transition-colors hover:dd-bg-elevated"
                 :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
                 @click="navigateTo('/servers')">
              <span class="badge px-1.5 py-0 text-[9px] max-md:!hidden"
                    :style="{
                      backgroundColor: server.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                <AppIcon :name="server.status === 'connected' ? 'check' : 'xmark'" :size="12" />
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-[12px] font-semibold truncate dd-text">{{ server.name }}</div>
                <div v-if="server.host" class="text-[10px] font-mono dd-text-muted truncate mt-0.5">
                  {{ server.host }}
                </div>
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
            <div v-if="totalUpdates === 0"
                 class="p-3 dd-rounded text-[11px] text-center dd-text-muted"
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
                <div class="text-[10px] font-medium uppercase tracking-wider mt-0.5 dd-text-muted">{{ kind.label }}</div>
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
