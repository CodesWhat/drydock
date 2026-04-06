<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIconButton from '@/components/AppIconButton.vue';
import StatusDot from '@/components/StatusDot.vue';
import AppLogViewer from '../AppLogViewer.vue';
import { preferences } from '../../preferences/store';
import { usePreference } from '../../preferences/usePreference';
import type { AppLogEntry } from '../../types/log-entry';

const props = withDefaults(
  defineProps<{
    logLevel: string;
    entries: AppLogEntry[];
    loading: boolean;
    error: string;
    logLevelFilter: string;
    tail: number;
    componentFilter: string;
    components?: string[];
    streamingEnabled?: boolean;
    streamingConnected?: boolean;
  }>(),
  {
    components: () => [],
    streamingEnabled: false,
    streamingConnected: false,
  },
);

const emit = defineEmits<{
  (e: 'update:logLevelFilter', value: string): void;
  (e: 'update:tail', value: number): void;
  (e: 'update:componentFilter', value: string): void;
  (e: 'update:streamingEnabled', value: boolean): void;
  (e: 'toggle-pause'): void;
}>();

const logLevelFilterModel = computed({
  get: () => props.logLevelFilter,
  set: (value: string) => emit('update:logLevelFilter', value),
});

const tailModel = computed({
  get: () => props.tail,
  set: (value: number) => emit('update:tail', value),
});

const componentFilterModel = computed({
  get: () => props.componentFilter,
  set: (value: string) => emit('update:componentFilter', value),
});

const streamingEnabledModel = computed({
  get: () => props.streamingEnabled,
  set: (value: boolean) => emit('update:streamingEnabled', value),
});

const newestFirst = usePreference(
  () => preferences.views.logs.newestFirst,
  (value) => {
    preferences.views.logs.newestFirst = value;
  },
);

const autoScrollPinned = ref(true);

const filtersModified = computed(
  () => props.logLevelFilter !== 'all' || props.tail !== 100 || props.componentFilter !== '',
);

function resetFilters() {
  emit('update:logLevelFilter', 'all');
  emit('update:tail', 100);
  emit('update:componentFilter', '');
}

const viewerPaused = computed(() => !props.streamingEnabled);
const statusLabel = computed(() => {
  if (viewerPaused.value) {
    return 'Paused';
  }
  return props.streamingConnected ? 'Live' : 'Offline';
});
const statusColor = computed(() => {
  if (viewerPaused.value) {
    return 'var(--dd-warning)';
  }
  return props.streamingConnected ? 'var(--dd-success)' : 'var(--dd-danger)';
});

function levelColor(level: string | null | undefined): string {
  const value = (level || '').toLowerCase();
  if (value === 'error' || value === 'fatal') {
    return 'var(--dd-danger)';
  }
  if (value === 'warn' || value === 'warning') {
    return 'var(--dd-warning)';
  }
  if (value === 'info') {
    return 'var(--dd-info)';
  }
  if (value === 'debug' || value === 'trace') {
    return 'var(--dd-text-secondary)';
  }
  return 'var(--dd-text-secondary)';
}

function togglePin() {
  autoScrollPinned.value = !autoScrollPinned.value;
}
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 gap-6">
    <div
      class="dd-rounded overflow-hidden flex flex-col flex-1 min-h-0"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div class="p-5 flex flex-col flex-1 min-h-0 gap-4">
        <div v-if="props.loading" class="text-xs dd-text-muted text-center py-6">Loading logs...</div>

        <div
          v-else-if="props.error"
          class="text-2xs-plus px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
        >
          {{ props.error }}
        </div>

        <AppLogViewer
          v-else
          v-model:newest-first="newestFirst"
          class="flex-1 min-h-0"
          :entries="props.entries"
          empty-message="No log entries found for current filters."
          :paused="viewerPaused"
          :auto-scroll-pinned="autoScrollPinned"
          :status-label="statusLabel"
          :status-color="statusColor"
          :line-count="props.entries.length"
          @toggle-pause="emit('toggle-pause')"
          @toggle-pin="togglePin"
        >
          <template #toolbar-left>
            <label
              class="flex items-center gap-1.5 px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide cursor-pointer dd-bg dd-text select-none"
            >
              <input
                type="checkbox"
                :checked="streamingEnabledModel"
                class="accent-[var(--dd-success)]"
                @change="streamingEnabledModel = ($event.target as HTMLInputElement).checked"
              />
              <StatusDot
                v-if="props.streamingConnected"
                status="connected"
                size="md"
              />
              Live
            </label>

            <select
              v-model="logLevelFilterModel"
              class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>

            <select
              v-model.number="tailModel"
              class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
            >
              <option :value="50">Tail 50</option>
              <option :value="100">Tail 100</option>
              <option :value="500">Tail 500</option>
              <option :value="1000">Tail 1000</option>
            </select>

            <select
              v-model="componentFilterModel"
              class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
            >
              <option value="">All Components</option>
              <option v-for="comp in props.components" :key="comp" :value="comp">{{ comp }}</option>
            </select>
          </template>

          <template v-if="filtersModified" #toolbar-right>
            <AppIconButton
              icon="restart"
              size="xs"
              tooltip="Reset filters"
              @click="resetFilters"
            />
          </template>

          <template #footer-extra>
            <span
              class="px-1.5 py-0.5 dd-rounded text-3xs font-bold uppercase tracking-wider dd-text-muted cursor-default"
              style="background-color: var(--dd-log-footer-bg); border: 1px solid var(--dd-log-divider)"
              v-tooltip="`Server log level: ${props.logLevel}. Only messages at this level or above are captured.`"
            >{{ props.logLevel }}</span>
          </template>

          <template #entry-prefix="{ entry }">
            <span class="shrink-0 w-10 uppercase font-semibold text-2xs" :style="{ color: levelColor(entry.level) }">
              {{ entry.level || 'info' }}
            </span>
            <span
              class="shrink-0 w-44 truncate dd-text-secondary"
              v-tooltip="entry.component"
            >{{ entry.component || '-' }}</span>
          </template>
        </AppLogViewer>
      </div>
    </div>
  </div>
</template>
