<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { getAllRegistries } from '../services/registry';

const registriesViewMode = ref<'table' | 'cards' | 'list'>('table');
const expandedConfigItems = reactive(new Set<string>());

const registriesData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

function registryTypeBadge(type: string) {
  if (type === 'hub') return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Hub' };
  if (type === 'ghcr') return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'GHCR' };
  if (type === 'quay')
    return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)', label: 'Quay' };
  if (type === 'ecr')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'ECR' };
  if (type === 'gitlab')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'GitLab' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

function toggleConfigItem(id: string) {
  if (expandedConfigItems.has(id)) expandedConfigItems.delete(id);
  else expandedConfigItems.add(id);
}

onMounted(async () => {
  try {
    const data = await getAllRegistries();
    registriesData.value = data.map((r: any) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      status: 'connected',
      config: r.configuration ?? {},
    }));
  } catch {
    error.value = 'Failed to load registries';
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
                {{ registriesData.length }} registries
              </span>
              <div class="flex items-center dd-rounded overflow-hidden border"
                   :style="{ borderColor: 'var(--dd-border-strong)' }">
                <button v-for="vm in ([
                  { id: 'table', icon: 'fa-solid fa-table-list' },
                  { id: 'cards', icon: 'fa-solid fa-grip' },
                  { id: 'list', icon: 'fa-solid fa-list' },
                ] as const)" :key="vm.id"
                        class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                        :class="registriesViewMode === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                        :style="vm.id !== 'table' ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                        @click="registriesViewMode = vm.id">
                  <i :class="vm.icon" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Table view -->
      <div v-if="registriesViewMode === 'table'"
           class="dd-rounded overflow-hidden"
           :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
        <table class="w-full text-xs">
          <thead>
            <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <th class="text-left px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted" style="width: 99%;">Registry</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Type</th>
              <th class="text-center px-3 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">Status</th>
              <th class="text-right px-5 py-2.5 font-semibold uppercase tracking-wider text-[10px] dd-text-muted whitespace-nowrap">URL</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(reg, i) in registriesData" :key="reg.id"
                class="transition-colors hover:dd-bg-elevated"
                :style="{
                  backgroundColor: i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)',
                  borderBottom: i < registriesData.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
                }">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full shrink-0"
                       :style="{ backgroundColor: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
                  <span class="font-medium dd-text">{{ reg.name }}</span>
                </div>
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap">
                <span class="badge text-[9px] uppercase font-bold"
                      :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
                  {{ registryTypeBadge(reg.type).label }}
                </span>
              </td>
              <td class="px-3 py-3 text-center whitespace-nowrap">
                <span class="badge text-[9px] font-bold"
                      :style="{
                        backgroundColor: reg.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }">
                  {{ reg.status }}
                </span>
              </td>
              <td class="px-5 py-3 text-right whitespace-nowrap font-mono text-[10px] dd-text-secondary">
                {{ reg.config.url || '\u2014' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Card view -->
      <div v-if="registriesViewMode === 'cards'"
           class="grid gap-4"
           style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
        <div v-for="reg in registriesData" :key="reg.id"
             class="dd-rounded overflow-hidden flex flex-col"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                   :style="{ backgroundColor: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">{{ reg.name }}</div>
                <div class="text-[11px] truncate mt-0.5 dd-text-muted font-mono">{{ reg.config.url || '\u2014' }}</div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
              {{ registryTypeBadge(reg.type).label }}
            </span>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div v-for="(val, key) in reg.config" :key="key">
                <span class="dd-text-muted">{{ key }}</span>
                <div class="font-semibold truncate dd-text">{{ val }}</div>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="badge text-[9px] font-bold"
                  :style="{
                    backgroundColor: reg.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ reg.status }}
            </span>
          </div>
        </div>
      </div>

      <!-- List view (accordion) -->
      <div v-if="registriesViewMode === 'list'" class="space-y-3">
        <div v-for="reg in registriesData" :key="reg.id"
             class="dd-rounded overflow-hidden transition-all"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors hover:dd-bg-elevated"
               @click="toggleConfigItem(reg.id)">
            <div class="w-2.5 h-2.5 rounded-full shrink-0"
                 :style="{ backgroundColor: reg.status === 'connected' ? 'var(--dd-success)' : reg.status === 'error' ? 'var(--dd-danger)' : 'var(--dd-neutral)' }" />
            <AppIcon name="registries" :size="14" class="dd-text-secondary" />
            <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ reg.name }}</span>
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
              {{ registryTypeBadge(reg.type).label }}
            </span>
            <i class="pi text-[10px] transition-transform shrink-0"
               :class="[expandedConfigItems.has(reg.id) ? 'pi-angle-up' : 'pi-angle-down', 'dd-text-muted']" />
          </div>
          <div v-if="expandedConfigItems.has(reg.id)"
               class="px-5 pb-4 pt-1"
               :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
              <div v-for="(val, key) in reg.config" :key="key">
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
                <div class="text-[12px] font-mono dd-text">{{ val }}</div>
              </div>
              <div>
                <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
                <span class="badge text-[10px] font-semibold"
                      :style="{
                        backgroundColor: reg.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }">{{ reg.status }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
