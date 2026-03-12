<script setup lang="ts">
import { computed } from 'vue';
import type { LogAutoFetchIntervalOption } from '../../composables/useLogViewerBehavior';
import LogViewer from '../LogViewer.vue';

interface AppLogEntry {
  timestamp?: string | number;
  level?: string;
  component?: string;
  msg?: string;
  message?: string;
}

const props = defineProps<{
  logLevel: string;
  entries: AppLogEntry[];
  loading: boolean;
  error: string;
  logLevelFilter: string;
  tail: number;
  autoFetchInterval: number;
  componentFilter: string;
  autoFetchOptions: LogAutoFetchIntervalOption[];
  scrollBlocked: boolean;
  lastFetchedIso: string;
  formatLastFetched: (iso: string) => string;
  formatTimestamp: (value: string | number | undefined) => string;
  messageForEntry: (entry: AppLogEntry) => string;
  levelColor: (level: string | undefined) => string;
}>();

const emit = defineEmits<{
  (e: 'update:logLevelFilter', value: string): void;
  (e: 'update:tail', value: number): void;
  (e: 'update:autoFetchInterval', value: number): void;
  (e: 'update:componentFilter', value: string): void;
  (e: 'refresh'): void;
  (e: 'reset'): void;
  (e: 'resume-auto-scroll'): void;
  (e: 'log-scroll'): void;
  (e: 'set-log-container', value: HTMLElement | null): void;
}>();

const logLevelFilterModel = computed({
  get: () => props.logLevelFilter,
  set: (value: string) => emit('update:logLevelFilter', value),
});

const tailModel = computed({
  get: () => props.tail,
  set: (value: number) => emit('update:tail', value),
});

const autoFetchIntervalModel = computed({
  get: () => props.autoFetchInterval,
  set: (value: number) => emit('update:autoFetchInterval', value),
});

const componentFilterModel = computed({
  get: () => props.componentFilter,
  set: (value: string) => emit('update:componentFilter', value),
});

function asEntry(entry: unknown): AppLogEntry {
  return entry as AppLogEntry;
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
        <LogViewer
          class="flex-1 min-h-0"
          :entries="props.entries"
          :loading="props.loading"
          :error="props.error"
          empty-message="No log entries found for current filters."
          container-class="dd-rounded overflow-auto flex-1 min-h-0 font-mono text-[0.6875rem]"
          :container-style="{
            backgroundColor: 'var(--dd-bg-inset)',
          }"
          @container-ready="(element) => emit('set-log-container', element)"
          @scroll="emit('log-scroll')"
        >
          <template #controls>
            <div class="flex flex-wrap items-center gap-2">
              <select
                v-model="logLevelFilterModel"
                class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
              >
                <option value="all">All Levels</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>

              <select
                v-model.number="tailModel"
                class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
              >
                <option :value="50">Tail 50</option>
                <option :value="100">Tail 100</option>
                <option :value="500">Tail 500</option>
                <option :value="1000">Tail 1000</option>
              </select>

              <select
                v-model.number="autoFetchIntervalModel"
                class="px-2 py-1.5 dd-rounded text-[0.6875rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
              >
                <option v-for="opt in props.autoFetchOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>

              <input
                v-model="componentFilterModel"
                type="text"
                placeholder="Filter by component..."
                class="flex-1 min-w-[180px] max-w-[280px] px-2.5 py-1.5 dd-rounded text-[0.6875rem] font-medium outline-none dd-bg dd-text dd-placeholder"
                @keyup.enter="emit('refresh')"
              />

              <button
                class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
                :class="props.loading ? 'opacity-50 pointer-events-none' : ''"
                @click="emit('refresh')"
              >
                Apply
              </button>
              <button
                class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text"
                :class="props.loading ? 'opacity-50 pointer-events-none' : ''"
                @click="emit('reset')"
              >
                Reset
              </button>
              <button
                class="p-1.5 dd-rounded transition-colors dd-text-muted hover:dd-text"
                :class="props.loading ? 'opacity-50 pointer-events-none' : ''"
                v-tooltip.top="'Refresh'"
                @click="emit('refresh')"
              >
                <AppIcon name="refresh" :size="12" />
              </button>
              <div class="ml-auto text-[0.625rem] dd-text-muted">
                Server Level: <span class="font-semibold dd-text capitalize">{{ props.logLevel }}</span>
              </div>
            </div>
          </template>

          <template #meta>
            <div class="text-[0.625rem] dd-text-muted">
              Last fetched: {{ props.formatLastFetched(props.lastFetchedIso) }}
            </div>
          </template>

          <template #entry="{ entry, index }">
            <div
              class="px-3 py-2 flex gap-3 items-start"
              :style="{ backgroundColor: index % 2 === 0 ? 'var(--dd-bg-inset)' : 'var(--dd-bg-card)' }"
            >
              <span class="shrink-0 tabular-nums dd-text-muted">{{ props.formatTimestamp(asEntry(entry).timestamp) }}</span>
              <span class="shrink-0 uppercase font-semibold" :style="{ color: props.levelColor(asEntry(entry).level) }">
                {{ asEntry(entry).level || 'info' }}
              </span>
              <span class="shrink-0 dd-text-secondary">{{ asEntry(entry).component || '-' }}</span>
              <span class="dd-text break-all">{{ props.messageForEntry(asEntry(entry)) }}</span>
            </div>
          </template>

          <template #footer>
            <div
              v-if="props.scrollBlocked && props.autoFetchInterval > 0"
              class="flex items-center justify-between px-3 py-2 text-[0.625rem]"
              :style="{ backgroundColor: 'var(--dd-warning-muted)' }"
            >
              <span class="font-semibold" :style="{ color: 'var(--dd-warning)' }">Auto-scroll paused</span>
              <button
                class="px-2 py-0.5 dd-rounded text-[0.625rem] font-semibold transition-colors"
                :style="{ backgroundColor: 'var(--dd-warning)', color: 'var(--dd-bg)' }"
                @click="emit('resume-auto-scroll')"
              >
                Resume
              </button>
            </div>
          </template>
        </LogViewer>
      </div>
    </div>
  </div>
</template>
