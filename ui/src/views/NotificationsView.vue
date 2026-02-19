<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppLayout from '../layouts/AppLayout.vue';
import { getAllTriggers } from '../services/trigger';

const notificationsViewMode = ref<'table' | 'cards' | 'list'>('table');
const loading = ref(true);
const error = ref('');

// Trigger name lookup map populated from API
const triggerMap = ref<Record<string, string>>({});

// Notification rules remain as local state (no backend endpoint yet)
const notificationsData = ref([
  { id: 'update-available', name: 'Update Available', enabled: true, triggers: [] as string[], description: 'When a container has a new version' },
  { id: 'update-applied', name: 'Update Applied', enabled: true, triggers: [] as string[], description: 'After a container is successfully updated' },
  { id: 'update-failed', name: 'Update Failed', enabled: true, triggers: [] as string[], description: 'When an update fails or is rolled back' },
  { id: 'security-alert', name: 'Security Alert', enabled: true, triggers: [] as string[], description: 'Critical/High vulnerability detected' },
  { id: 'agent-disconnect', name: 'Agent Disconnected', enabled: false, triggers: [] as string[], description: 'When a remote agent loses connection' },
]);

function triggerNameById(id: string) {
  return triggerMap.value[id] ?? id;
}

function toggleNotification(id: string) {
  const notif = notificationsData.value.find(n => n.id === id);
  if (notif) notif.enabled = !notif.enabled;
}

onMounted(async () => {
  try {
    const triggers = await getAllTriggers();
    const map: Record<string, string> = {};
    for (const t of triggers) {
      map[t.id] = t.name;
    }
    triggerMap.value = map;

    // Assign all fetched trigger IDs to the first three notification rules
    // so there's something meaningful to display; adjust as needed once
    // a notifications backend endpoint exists.
    const allIds = triggers.map((t: any) => t.id);
    if (notificationsData.value.length > 0) {
      notificationsData.value[0].triggers = allIds;
    }
    if (notificationsData.value.length > 1) {
      notificationsData.value[1].triggers = allIds.slice(0, 1);
    }
    if (notificationsData.value.length > 2) {
      notificationsData.value[2].triggers = allIds;
    }
    if (notificationsData.value.length > 3) {
      notificationsData.value[3].triggers = allIds.filter((_: any, i: number) => i % 2 === 0);
    }
  } catch {
    error.value = 'Failed to load triggers';
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
                {{ notificationsData.length }} rules
              </span>
              <div class="flex items-center dd-rounded overflow-hidden border"
                   :style="{ borderColor: 'var(--dd-border-strong)' }">
                <button v-for="vm in ([
                  { id: 'table', icon: 'fa-solid fa-table-list' },
                  { id: 'cards', icon: 'fa-solid fa-grip' },
                  { id: 'list', icon: 'fa-solid fa-list' },
                ] as const)" :key="vm.id"
                        class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                        :class="notificationsViewMode === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                        :style="vm.id !== 'table' ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                        @click="notificationsViewMode = vm.id">
                  <i :class="vm.icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table view -->
      <div v-if="notificationsViewMode === 'table'"
           class="dd-rounded overflow-hidden"
           :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
        <table class="w-full text-xs">
          <thead>
            <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap w-12">On</th>
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted" style="width: 99%;">Rule</th>
              <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Triggers</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(notif, i) in notificationsData" :key="notif.id"
                class="transition-colors hover:dd-bg-elevated"
                :style="{
                  backgroundColor: i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)',
                  borderBottom: i < notificationsData.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
                }">
              <td class="px-3 py-3 text-center">
                <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors mx-auto"
                     :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                     @click="toggleNotification(notif.id)">
                  <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                       :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
                </div>
              </td>
              <td class="px-5 py-3">
                <div class="font-medium dd-text">{{ notif.name }}</div>
                <div class="text-[10px] mt-0.5 dd-text-muted">{{ notif.description }}</div>
              </td>
              <td class="px-5 py-3 text-right">
                <div class="flex flex-wrap gap-1 justify-end">
                  <span v-for="tId in notif.triggers" :key="tId"
                        class="badge text-[9px] font-semibold"
                        :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
                    {{ triggerNameById(tId) }}
                  </span>
                  <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">None</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Card view -->
      <div v-if="notificationsViewMode === 'cards'"
           class="grid gap-4"
           style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        <div v-for="notif in notificationsData" :key="notif.id"
             class="dd-rounded overflow-hidden flex flex-col"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <div class="text-[15px] font-semibold truncate dd-text">{{ notif.name }}</div>
              <div class="text-[11px] mt-0.5 dd-text-muted">{{ notif.description }}</div>
            </div>
            <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 ml-3 transition-colors"
                 :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                 @click="toggleNotification(notif.id)">
              <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                   :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
            </div>
          </div>
          <div class="px-4 py-2.5 flex flex-wrap gap-1.5 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-for="tId in notif.triggers" :key="tId"
                  class="badge text-[9px] font-semibold"
                  :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
              {{ triggerNameById(tId) }}
            </span>
            <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">No triggers</span>
          </div>
        </div>
      </div>

      <!-- List view -->
      <div v-if="notificationsViewMode === 'list'" class="space-y-3">
        <div v-for="notif in notificationsData" :key="notif.id"
             class="dd-rounded overflow-hidden transition-all"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex items-center gap-3 px-5 py-3.5">
            <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors"
                 :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                 @click="toggleNotification(notif.id)">
              <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                   :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold dd-text">{{ notif.name }}</div>
              <div class="text-[11px] mt-0.5 dd-text-muted">{{ notif.description }}</div>
            </div>
            <div class="flex flex-wrap gap-1.5 shrink-0 max-w-[260px] justify-end">
              <span v-for="tId in notif.triggers" :key="tId"
                    class="badge text-[9px] font-semibold"
                    :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
                {{ triggerNameById(tId) }}
              </span>
              <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">No triggers</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
