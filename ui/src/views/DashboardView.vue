<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getAgents } from '../services/agent';
import { getAllContainers } from '../services/container';
import { getServer } from '../services/server';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';

const router = useRouter();

function navigateTo(route: string) {
  router.push(route);
}

// Loading and error state
const loading = ref(true);
const error = ref<string | null>(null);

// Raw data from APIs
const containers = ref<Container[]>([]);
const serverInfo = ref<any>(null);
const agents = ref<any[]>([]);

// Fetch all dashboard data
onMounted(async () => {
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
});

// Computed: stat cards
const stats = computed(() => {
  const total = containers.value.length;
  const updatesAvailable = containers.value.filter((c) => c.updateKind).length;
  const securityIssues = containers.value.filter(
    (c) => c.bouncer === 'blocked' || c.bouncer === 'unsafe',
  ).length;
  return [
    {
      label: 'Containers',
      value: String(total),
      icon: 'containers',
      color: 'var(--dd-primary)',
      colorMuted: 'var(--dd-primary-muted)',
      trend: '+0',
    },
    {
      label: 'Updates Available',
      value: String(updatesAvailable),
      icon: 'updates',
      color: 'var(--dd-warning)',
      colorMuted: 'var(--dd-warning-muted)',
      trend: '+0',
    },
    {
      label: 'Security Issues',
      value: String(securityIssues),
      icon: 'security',
      color: 'var(--dd-danger)',
      colorMuted: 'var(--dd-danger-muted)',
      trend: '+0',
    },
    {
      label: 'Uptime',
      value: '99.8%',
      icon: 'uptime',
      color: 'var(--dd-success)',
      colorMuted: 'var(--dd-success-muted)',
      trend: '+0.0%',
    },
  ];
});

// Computed: recent updates (containers that have pending updates)
const recentUpdates = computed(() => {
  return containers.value
    .filter((c) => c.newTag)
    .slice(0, 8)
    .map((c) => ({
      name: c.name,
      image: c.image,
      icon: c.icon,
      oldVer: c.currentTag,
      newVer: c.newTag ?? '',
      status: 'pending' as const,
      time: '',
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
</script>

<template>
      <!-- LOADING STATE -->
      <div v-if="loading" class="flex items-center justify-center py-16">
        <div class="text-sm dd-text-muted">Loading dashboard...</div>
      </div>

      <!-- ERROR STATE -->
      <div v-else-if="error" class="flex flex-col items-center justify-center py-16">
        <div class="text-sm font-medium dd-text-danger mb-2">Failed to load dashboard</div>
        <div class="text-xs dd-text-muted">{{ error }}</div>
      </div>

      <template v-else>
      <!-- STAT CARDS -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div v-for="stat in stats" :key="stat.label"
             class="stat-card dd-rounded p-4"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               borderTop: '1px solid var(--dd-border-strong)',
               borderRight: '1px solid var(--dd-border-strong)',
               borderBottom: '1px solid var(--dd-border-strong)',
               borderLeft: `4px solid ${stat.color}`,
             }">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[11px] font-medium uppercase tracking-wider dd-text-muted">
              {{ stat.label }}
            </span>
            <div class="w-8 h-8 dd-rounded flex items-center justify-center"
                 :style="{ backgroundColor: stat.colorMuted, color: stat.color }">
              <AppIcon :name="stat.icon" :size="14" />
            </div>
          </div>
          <div class="text-2xl font-bold dd-text">
            {{ stat.value }}
          </div>
          <div class="text-[11px] mt-1 flex items-center gap-1"
               :style="{ color: stat.trend.startsWith('+') ? 'var(--dd-success)' : stat.trend.startsWith('-') ? 'var(--dd-danger)' : 'var(--dd-neutral)' }">
            <AppIcon :name="stat.trend.startsWith('+') ? 'trend-up' : stat.trend.startsWith('-') ? 'trend-down' : 'neutral'" :size="9" />
            {{ stat.trend }} from last week
          </div>
        </div>
      </div>

      <!-- WIDGET GRID -->
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">

        <!-- Recent Updates Widget (2/3) -->
        <div class="xl:col-span-2 dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="recent-updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Container Log
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo('/containers')">View all &rarr;</button>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Container</th>
                  <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Image</th>
                  <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Version</th>
                  <th class="text-center px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Status</th>
                  <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted">Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in recentUpdates" :key="i"
                    class="transition-colors hover:dd-bg-elevated"
                    :style="{ borderBottom: i < recentUpdates.length - 1 ? '1px solid var(--dd-border-strong)' : 'none' }">
                  <td class="px-5 py-3 font-medium dd-text">
                    <div class="flex items-center gap-2">
                      <ContainerIcon :icon="row.icon" :size="16" class="shrink-0" />
                      {{ row.name }}
                    </div>
                  </td>
                  <td class="px-5 py-3 text-center dd-text-secondary">
                    {{ row.image }}
                  </td>
                  <td class="px-5 py-3">
                    <div class="grid items-center gap-1.5" style="grid-template-columns: 1fr auto 1fr;">
                      <span class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium text-right justify-self-end dd-bg-elevated dd-text-secondary">
                        {{ row.oldVer }}
                      </span>
                      <AppIcon name="arrow-right" :size="8" class="justify-self-center dd-text-muted" />
                      <span class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium justify-self-start"
                            style="background: var(--dd-primary-muted); color: var(--dd-primary);">
                        {{ row.newVer }}
                      </span>
                    </div>
                  </td>
                  <td class="px-5 py-3 text-center">
                    <span class="badge"
                          :style="{
                            backgroundColor: row.status === 'updated'
                              ? 'var(--dd-success-muted)'
                              : row.status === 'pending'
                                ? 'var(--dd-warning-muted)'
                                : 'var(--dd-danger-muted)',
                            color: row.status === 'updated' ? 'var(--dd-success)' : row.status === 'pending' ? 'var(--dd-warning)' : 'var(--dd-danger)',
                          }">
                      <AppIcon :name="row.status === 'updated' ? 'check' : row.status === 'pending' ? 'pending' : 'xmark'"
                         :size="8" class="mr-1" />
                      {{ row.status }}
                    </span>
                  </td>
                  <td class="px-5 py-3 text-right dd-text-muted">
                    {{ row.time }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Security Summary Widget (1/3) -->
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="security" :size="14" class="text-drydock-accent" />
              <h2 class="text-sm font-semibold dd-text">
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
                  <span class="badge text-[9px]"
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
        <div class="dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
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
              <div class="w-2.5 h-2.5 rounded-full shrink-0"
                   :style="{ backgroundColor: server.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <div class="flex-1 min-w-0">
                <div class="text-[12px] font-semibold truncate dd-text">{{ server.name }}</div>
                <div class="text-[10px] dd-text-muted">{{ server.containers.running }}/{{ server.containers.total }} containers</div>
              </div>
              <span class="badge text-[9px] uppercase font-bold"
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
        <div class="xl:col-span-2 dd-rounded overflow-hidden"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="flex items-center justify-between px-5 py-3.5"
               :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
            <div class="flex items-center gap-2">
              <AppIcon name="updates" :size="14" class="text-drydock-secondary" />
              <h2 class="text-sm font-semibold dd-text">
                Update Breakdown
              </h2>
            </div>
            <button class="text-[11px] font-medium text-drydock-secondary hover:underline"
                    @click="navigateTo('/containers')">View all &rarr;</button>
          </div>

          <div class="p-5">
            <div class="grid grid-cols-4 gap-4">
              <div v-for="kind in [
                { label: 'Major', count: containers.filter(c => c.updateKind === 'major').length, color: 'var(--dd-danger)', colorMuted: 'var(--dd-danger-muted)', icon: 'fa-solid fa-angles-up' },
                { label: 'Minor', count: containers.filter(c => c.updateKind === 'minor').length, color: 'var(--dd-warning)', colorMuted: 'var(--dd-warning-muted)', icon: 'fa-solid fa-angle-up' },
                { label: 'Patch', count: containers.filter(c => c.updateKind === 'patch').length, color: 'var(--dd-primary)', colorMuted: 'var(--dd-primary-muted)', icon: 'fa-solid fa-hashtag' },
                { label: 'Digest', count: containers.filter(c => c.updateKind === 'digest').length, color: 'var(--dd-neutral)', colorMuted: 'var(--dd-neutral-muted)', icon: 'fa-solid fa-fingerprint' },
              ]" :key="kind.label"
                   class="text-center p-3 dd-rounded"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="w-8 h-8 mx-auto dd-rounded flex items-center justify-center mb-2"
                     :style="{ backgroundColor: kind.colorMuted, color: kind.color }">
                  <i :class="kind.icon" class="text-[12px]" />
                </div>
                <div class="text-xl font-bold dd-text">{{ kind.count }}</div>
                <div class="text-[10px] font-medium uppercase tracking-wider mt-0.5 dd-text-muted">{{ kind.label }}</div>
                <!-- Mini bar -->
                <div class="mt-2 h-1.5 dd-rounded-sm overflow-hidden" style="background: var(--dd-bg-elevated);">
                  <div class="h-full dd-rounded-sm transition-all"
                       :style="{ width: Math.max(kind.count / 16 * 100, 4) + '%', backgroundColor: kind.color }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </template>
</template>
