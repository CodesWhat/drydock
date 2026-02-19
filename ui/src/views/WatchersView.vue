<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import AppLayout from '../layouts/AppLayout.vue';
import AppIcon from '../components/AppIcon.vue';
import { getAllWatchers } from '../services/watcher';

const watchersViewMode = ref<'table' | 'cards' | 'list'>('table');
const expandedConfigItems = reactive(new Set<string>());

const watchersData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

function watcherStatusColor(status: string) {
  if (status === 'watching') return 'var(--dd-success)';
  if (status === 'paused') return 'var(--dd-warning)';
  return 'var(--dd-neutral)';
}

function toggleConfigItem(id: string) {
  if (expandedConfigItems.has(id)) expandedConfigItems.delete(id);
  else expandedConfigItems.add(id);
}

onMounted(async () => {
  try {
    const data = await getAllWatchers();
    watchersData.value = data.map((w: any) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      status: 'watching',
      containers: 0,
      cron: w.configuration?.cron ?? '',
      lastRun: '',
      config: w.configuration ?? {},
    }));
  } catch {
    error.value = 'Failed to load watchers';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AppLayout>
    <div class="p-6">
      <!-- Filter bar -->
      <div class="shrink-0 mb-4">
        <div class="px-3 py-2 dd-rounded"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex items-center gap-2.5">
            <div class="flex items-center gap-2 ml-auto">
              <span class="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 dd-rounded dd-text-muted dd-bg-card">
                {{ watchersData.length }} watchers
              </span>
              <div class="flex items-center dd-rounded overflow-hidden border"
                   :style="{ borderColor: 'var(--dd-border-strong)' }">
                <button v-for="vm in ([
                  { id: 'table', icon: 'fa-solid fa-table-list' },
                  { id: 'cards', icon: 'fa-solid fa-grip' },
                  { id: 'list', icon: 'fa-solid fa-list' },
                ] as const)" :key="vm.id"
                        class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                        :class="watchersViewMode === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                        :style="vm.id !== 'table' ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                        @click="watchersViewMode = vm.id">
                  <i :class="vm.icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table view -->
      <div v-if="watchersViewMode === 'table'"
           class="dd-rounded overflow-hidden"
           :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
        <table class="w-full text-xs">
          <thead>
            <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted" style="width: 99%;">Watcher</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Status</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Containers</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Schedule</th>
              <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Last Run</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(watcher, i) in watchersData" :key="watcher.id"
                class="transition-colors hover:dd-bg-elevated"
                :style="{
                  backgroundColor: i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)',
                  borderBottom: i < watchersData.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
                }">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full shrink-0"
                       :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
                  <span class="font-medium dd-text">{{ watcher.name }}</span>
                </div>
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap">
                <span class="badge text-[9px] font-bold"
                      :style="{
                        backgroundColor: watcher.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                        color: watcher.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
                      }">
                  {{ watcher.status }}
                </span>
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap dd-text-secondary">
                {{ watcher.containers }}
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap font-mono text-[10px] dd-text-secondary">
                {{ watcher.cron }}
              </td>
              <td class="px-5 py-3 text-right whitespace-nowrap dd-text-muted">
                {{ watcher.lastRun }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Card view -->
      <div v-if="watchersViewMode === 'cards'"
           class="grid gap-4"
           style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        <div v-for="watcher in watchersData" :key="watcher.id"
             class="dd-rounded overflow-hidden flex flex-col"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                   :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">{{ watcher.name }}</div>
                <div class="text-[11px] truncate mt-0.5 dd-text-muted font-mono">{{ watcher.cron }}</div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                  :style="{
                    backgroundColor: watcher.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                    color: watcher.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
                  }">
              {{ watcher.status }}
            </span>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span class="dd-text-muted">Containers</span>
                <span class="ml-1 font-semibold dd-text">{{ watcher.containers }}</span>
              </div>
              <div>
                <span class="dd-text-muted">Last run</span>
                <span class="ml-1 font-semibold dd-text">{{ watcher.lastRun }}</span>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="text-[10px] dd-text-muted">{{ watcher.containers }} containers watched</span>
          </div>
        </div>
      </div>

      <!-- List view (accordion) -->
      <div v-if="watchersViewMode === 'list'" class="space-y-3">
        <div v-for="watcher in watchersData" :key="watcher.id"
             class="dd-rounded overflow-hidden transition-all"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors hover:dd-bg-elevated"
               @click="toggleConfigItem(watcher.id)">
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: watcherStatusColor(watcher.status) }" />
            <AppIcon name="watchers" :size="14" class="dd-text-secondary" />
            <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ watcher.name }}</span>
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{
                    backgroundColor: watcher.status === 'watching' ? 'var(--dd-success-muted)' : 'var(--dd-warning-muted)',
                    color: watcher.status === 'watching' ? 'var(--dd-success)' : 'var(--dd-warning)',
                  }">
              {{ watcher.status }}
            </span>
            <span v-if="watcher.config.maintenanceWindow"
                  class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: 'var(--dd-alt-muted)', color: 'var(--dd-alt)' }">
              Maint
            </span>
            <i class="pi text-[10px] transition-transform shrink-0"
               :class="[expandedConfigItems.has(watcher.id) ? 'pi-angle-up' : 'pi-angle-down', 'dd-text-muted']" />
          </div>
          <div v-if="expandedConfigItems.has(watcher.id)"
               class="px-5 pb-4 pt-1"
               :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Cron</div>
                <div class="text-[12px] font-mono dd-text">{{ watcher.cron }}</div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Last Run</div>
                <div class="text-[12px] font-mono dd-text">{{ watcher.lastRun }}</div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Containers Watched</div>
                <div class="text-[12px] font-mono dd-text">{{ watcher.containers }}</div>
              </div>
              <div v-for="(val, key) in watcher.config" :key="key">
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
                <div class="text-[12px] font-mono dd-text">{{ val }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
