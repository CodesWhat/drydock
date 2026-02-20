<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { getAllTriggers } from '../services/trigger';

const triggersViewMode = ref<'table' | 'cards' | 'list'>('table');
const expandedConfigItems = reactive(new Set<string>());

const triggersData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

function triggerTypeBadge(type: string) {
  if (type === 'slack')
    return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Slack' };
  if (type === 'discord')
    return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'Discord' };
  if (type === 'smtp')
    return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)', label: 'SMTP' };
  if (type === 'http')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'HTTP' };
  if (type === 'telegram')
    return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'Telegram' };
  if (type === 'mqtt')
    return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)', label: 'MQTT' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

function toggleConfigItem(id: string) {
  if (expandedConfigItems.has(id)) expandedConfigItems.delete(id);
  else expandedConfigItems.add(id);
}

onMounted(async () => {
  try {
    const data = await getAllTriggers();
    triggersData.value = data.map((t: any) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: 'active',
      config: t.configuration ?? {},
    }));
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
                {{ triggersData.length }} triggers
              </span>
              <div class="flex items-center dd-rounded overflow-hidden border"
                   :style="{ borderColor: 'var(--dd-border-strong)' }">
                <button v-for="vm in ([
                  { id: 'table', icon: 'fa-solid fa-table-list' },
                  { id: 'cards', icon: 'fa-solid fa-grip' },
                  { id: 'list', icon: 'fa-solid fa-list' },
                ] as const)" :key="vm.id"
                        class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                        :class="triggersViewMode === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                        :style="vm.id !== 'table' ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                        @click="triggersViewMode = vm.id">
                  <i :class="vm.icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table view -->
      <div v-if="triggersViewMode === 'table'"
           class="dd-rounded overflow-hidden"
           :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
        <table class="w-full text-xs">
          <thead>
            <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted" style="width: 99%;">Trigger</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Type</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(trigger, i) in triggersData" :key="trigger.id"
                class="transition-colors hover:dd-bg-elevated"
                :style="{
                  backgroundColor: i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)',
                  borderBottom: i < triggersData.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
                }">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full shrink-0"
                       :style="{ backgroundColor: trigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                  <span class="font-medium dd-text">{{ trigger.name }}</span>
                </div>
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap">
                <span class="badge text-[9px] uppercase font-bold"
                      :style="{ backgroundColor: triggerTypeBadge(trigger.type).bg, color: triggerTypeBadge(trigger.type).text }">
                  {{ triggerTypeBadge(trigger.type).label }}
                </span>
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap">
                <span class="badge text-[9px] font-bold"
                      :style="{
                        backgroundColor: trigger.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: trigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }">
                  {{ trigger.status }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Card view -->
      <div v-if="triggersViewMode === 'cards'"
           class="grid gap-4"
           style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        <div v-for="trigger in triggersData" :key="trigger.id"
             class="dd-rounded overflow-hidden flex flex-col"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                   :style="{ backgroundColor: trigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">{{ trigger.name }}</div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: triggerTypeBadge(trigger.type).bg, color: triggerTypeBadge(trigger.type).text }">
              {{ triggerTypeBadge(trigger.type).label }}
            </span>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-1 gap-2 text-[11px]">
              <div v-for="(val, key) in trigger.config" :key="key">
                <span class="dd-text-muted">{{ key }}</span>
                <div class="font-semibold truncate dd-text font-mono text-[10px]">{{ val }}</div>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="badge text-[9px] font-bold"
                  :style="{
                    backgroundColor: trigger.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: trigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ trigger.status }}
            </span>
            <button class="inline-flex items-center gap-1 px-2 py-1 dd-rounded text-[10px] font-bold transition-all text-white"
                    :style="{ background: 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))' }">
              <AppIcon name="play" :size="8" /> Test
            </button>
          </div>
        </div>
      </div>

      <!-- List view (accordion) -->
      <div v-if="triggersViewMode === 'list'" class="space-y-3">
        <div v-for="trigger in triggersData" :key="trigger.id"
             class="dd-rounded overflow-hidden transition-all"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors hover:dd-bg-elevated"
               @click="toggleConfigItem(trigger.id)">
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: trigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <AppIcon name="triggers" :size="14" class="dd-text-secondary" />
            <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ trigger.name }}</span>
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: triggerTypeBadge(trigger.type).bg, color: triggerTypeBadge(trigger.type).text }">
              {{ triggerTypeBadge(trigger.type).label }}
            </span>
            <i class="pi text-[10px] transition-transform shrink-0"
               :class="[expandedConfigItems.has(trigger.id) ? 'pi-angle-up' : 'pi-angle-down', 'dd-text-muted']" />
          </div>
          <div v-if="expandedConfigItems.has(trigger.id)"
               class="px-5 pb-4 pt-1"
               :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
              <div v-for="(val, key) in trigger.config" :key="key">
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
                <div class="text-[12px] font-mono dd-text">{{ val }}</div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
                <span class="badge text-[10px] font-semibold"
                      :style="{
                        backgroundColor: trigger.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: trigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }">{{ trigger.status }}</span>
              </div>
            </div>
            <div class="mt-4 pt-3" :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
              <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold tracking-wide transition-all text-white"
                      :style="{ background: 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))', boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }">
                <AppIcon name="play" :size="10" /> Test
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
