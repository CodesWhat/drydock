<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIconButton from '../AppIconButton.vue';
import LogViewer from '../LogViewer.vue';

interface AgentLog {
  displayTimestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
}

const props = defineProps<{
  logs: AgentLog[];
  loading: boolean;
  error: string;
  logLevelFilter: string;
  tail: number;
  componentFilter: string;
  lastFetchedIso: string;
  status: 'connected' | 'disconnected';
  formatLastFetched: (iso: string) => string;
}>();

const emit = defineEmits<{
  (e: 'update:logLevelFilter', value: string): void;
  (e: 'update:tail', value: number): void;
  (e: 'update:componentFilter', value: string): void;
  (e: 'refresh'): void;
  (e: 'reset'): void;
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

function asLog(entry: unknown): AgentLog {
  return entry as AgentLog;
}

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col" style="height: calc(100% - 0px);">
    <LogViewer
      :entries="props.logs"
      :loading="props.loading"
      :error="props.error"
      :empty-message="t('agentsView.detail.logs.emptyMessage')"
      panel-class="flex-1 min-h-0 flex flex-col overflow-hidden"
      :panel-style="{ backgroundColor: 'var(--dd-bg-code)' }"
      container-class="px-1"
      container-style="box-shadow: var(--dd-shadow-inset);"
      error-class="mx-3 mt-3 text-2xs-plus px-3 py-2 dd-rounded"
      empty-class="px-3 py-4 text-2xs-plus dd-text-muted text-center"
    >
      <template #controls>
        <div class="px-3 py-2 flex flex-wrap items-center gap-2">
          <select
            v-model="logLevelFilterModel"
            data-testid="agent-log-level-filter"
            class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
          >
            <option value="all">{{ t('agentsView.detail.logs.allLevels') }}</option>
            <option value="debug">{{ t('agentsView.detail.logs.levelDebug') }}</option>
            <option value="info">{{ t('agentsView.detail.logs.levelInfo') }}</option>
            <option value="warn">{{ t('agentsView.detail.logs.levelWarn') }}</option>
            <option value="error">{{ t('agentsView.detail.logs.levelError') }}</option>
          </select>

          <select
            v-model.number="tailModel"
            data-testid="agent-log-tail-filter"
            class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text"
          >
            <option :value="50">{{ t('agentsView.detail.logs.tail50') }}</option>
            <option :value="100">{{ t('agentsView.detail.logs.tail100') }}</option>
            <option :value="500">{{ t('agentsView.detail.logs.tail500') }}</option>
            <option :value="1000">{{ t('agentsView.detail.logs.tail1000') }}</option>
          </select>

          <input
            v-model="componentFilterModel"
            data-testid="agent-log-component-filter"
            type="text"
            :placeholder="t('agentsView.detail.logs.componentPlaceholder')"
            class="flex-1 min-w-[160px] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder"
            @keyup.enter="emit('refresh')"
          />

          <AppButton size="none" variant="plain" weight="none"
            data-testid="agent-log-apply"
            class="px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors dd-bg-elevated dd-text hover:opacity-90"
            :class="props.loading ? 'opacity-50 pointer-events-none' : ''"
            @click="emit('refresh')"
          >
            {{ t('agentsView.detail.logs.apply') }}
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            class="px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors dd-text-muted hover:dd-text"
            :class="props.loading ? 'opacity-50 pointer-events-none' : ''"
            @click="emit('reset')"
          >
            {{ t('agentsView.detail.logs.reset') }}
          </AppButton>
          <AppIconButton
            icon="refresh"
            size="toolbar"
            variant="plain"
            data-testid="agent-log-refresh"
            class="dd-text-muted hover:dd-text"
            :class="props.loading ? 'pointer-events-none' : ''"
            :tooltip="t('agentsView.detail.logs.refresh')"
            :disabled="props.loading"
            @click="emit('refresh')"
          />
        </div>
      </template>

      <template #meta>
        <div class="px-3 py-1 text-2xs dd-text-muted">
          {{ t('agentsView.detail.logs.lastFetched', { time: props.formatLastFetched(props.lastFetchedIso) }) }}
        </div>
      </template>

      <template #entry="{ entry }">
        <div
          class="px-3 py-[3px] font-mono text-2xs-plus leading-relaxed flex gap-3 transition-colors"
          :style="{ borderBottom: '1px solid var(--dd-log-line)' }"
        >
          <span class="shrink-0 tabular-nums" style="color: var(--dd-log-text-muted);">
            {{ asLog(entry).displayTimestamp }}
          </span>
          <span
            class="shrink-0 w-11 text-right font-semibold uppercase text-2xs"
            :style="{
              color: asLog(entry).level === 'error' ? 'var(--dd-danger)'
                   : asLog(entry).level === 'warn' ? 'var(--dd-warning)'
                   : asLog(entry).level === 'debug' ? 'var(--dd-log-text-muted)'
                   : 'var(--dd-success)'
            }"
          >
            {{ asLog(entry).level }}
          </span>
          <span class="shrink-0" style="color: var(--dd-primary);">{{ asLog(entry).component || '-' }}</span>
          <span class="break-all" style="color: var(--dd-log-text);">{{ asLog(entry).message }}</span>
        </div>
      </template>

      <template #footer>
        <div
          class="shrink-0 px-4 py-2 flex items-center justify-between"
          :style="{ borderTop: '1px solid var(--dd-log-divider)', backgroundColor: 'var(--dd-log-footer-bg)' }"
        >
          <span class="text-2xs font-medium" style="color: var(--dd-log-text-muted);">
            {{ t('agentsView.detail.logs.entries', { count: props.logs.length }) }}
          </span>
          <div class="flex items-center gap-1.5">
            <div
              class="w-2 h-2 rounded-full"
              :style="{ backgroundColor: props.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }"
            />
            <span
              class="text-2xs font-semibold"
              :style="{ color: props.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }"
            >
              {{ props.status === 'connected' ? t('agentsView.detail.logs.statusLive') : t('agentsView.detail.logs.statusOffline') }}
            </span>
          </div>
        </div>
      </template>
    </LogViewer>
  </div>
</template>
