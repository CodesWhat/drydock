<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface AgentDetailField {
  label: string;
  value: string | number;
  muted?: boolean;
}

interface Agent {
  containers: {
    total: number;
    running: number;
    stopped: number;
  };
  watchers: string[];
  triggers: string[];
}

const props = defineProps<{
  agent: Agent;
  resourceFields: AgentDetailField[];
  systemFields: AgentDetailField[];
}>();

defineEmits<{ 'view-containers': [] }>();

const { t } = useI18n();
</script>

<template>
  <div class="p-4 space-y-5">
    <div v-if="props.resourceFields.length > 0">
      <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">{{ t('agentsView.detail.overview.resources') }}</div>
      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="field in props.resourceFields"
          :key="field.label"
          class="px-2.5 py-1.5 dd-rounded text-2xs-plus"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
        >
          <div class="text-2xs dd-text-muted">{{ field.label }}</div>
          <div class="font-semibold" :class="field.muted ? 'dd-text-muted' : 'dd-text'">{{ field.value }}</div>
        </div>
      </div>
    </div>

    <div v-if="props.systemFields.length > 0">
      <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">{{ t('agentsView.detail.overview.system') }}</div>
      <div class="space-y-1">
        <div
          v-for="field in props.systemFields"
          :key="field.label"
          class="flex items-center justify-between px-2.5 py-1.5 dd-rounded text-2xs-plus"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
        >
          <span class="dd-text-muted">{{ field.label }}</span>
          <span class="font-mono font-semibold" :class="field.muted ? 'dd-text-muted' : 'dd-text'">{{ field.value }}</span>
        </div>
      </div>
    </div>

    <div>
      <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">{{ t('agentsView.detail.overview.containers') }}</div>
      <div class="grid grid-cols-3 gap-2 text-center">
        <div class="px-2 py-2 dd-rounded" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <div class="text-lg font-bold dd-text">{{ props.agent.containers.total }}</div>
          <div class="text-2xs dd-text-muted">{{ t('agentsView.detail.overview.containerTotal') }}</div>
        </div>
        <div class="px-2 py-2 dd-rounded" :style="{ backgroundColor: 'var(--dd-success-muted)' }">
          <div class="text-lg font-bold" :style="{ color: 'var(--dd-success)' }">{{ props.agent.containers.running }}</div>
          <div class="text-2xs" :style="{ color: 'var(--dd-success)' }">{{ t('agentsView.detail.overview.containerRunning') }}</div>
        </div>
        <div
          class="px-2 py-2 dd-rounded"
          :style="{ backgroundColor: props.agent.containers.stopped > 0 ? 'var(--dd-danger-muted)' : 'var(--dd-bg-inset)' }"
        >
          <div
            class="text-lg font-bold"
            :style="{ color: props.agent.containers.stopped > 0 ? 'var(--dd-danger)' : 'var(--dd-text-muted)' }"
          >
            {{ props.agent.containers.stopped }}
          </div>
          <div
            class="text-2xs"
            :style="{ color: props.agent.containers.stopped > 0 ? 'var(--dd-danger)' : 'var(--dd-text-muted)' }"
          >
            {{ t('agentsView.detail.overview.containerStopped') }}
          </div>
        </div>
      </div>
      <AppButton
        v-if="props.agent.containers.total > 0"
        size="none"
        variant="plain"
        weight="none"
        class="mt-2 inline-flex items-center gap-1 text-2xs-plus font-medium transition-colors text-drydock-secondary hover:text-drydock-secondary-hover"
        @click="$emit('view-containers')">
        <AppIcon name="arrow-right" :size="10" />
        {{ t('agentsView.detail.overview.viewContainers') }}
      </AppButton>
    </div>

    <div>
      <div class="text-2xs font-semibold uppercase tracking-wider mb-2 dd-text-muted">{{ t('agentsView.detail.overview.automation') }}</div>
      <div class="space-y-2">
        <div class="px-2.5 py-2 dd-rounded text-2xs-plus" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold dd-text">{{ t('agentsView.detail.overview.watchers') }}</span>
            <span class="text-2xs dd-text-muted">{{ props.agent.watchers.length }}</span>
          </div>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="watcherName in props.agent.watchers"
              :key="watcherName"
              class="px-1.5 py-0.5 dd-rounded text-2xs font-mono dd-bg-elevated dd-text-secondary"
            >
              {{ watcherName }}
            </span>
            <span v-if="props.agent.watchers.length === 0" class="text-2xs italic dd-text-muted">
              {{ t('agentsView.detail.overview.none') }}
            </span>
          </div>
        </div>

        <div class="px-2.5 py-2 dd-rounded text-2xs-plus" :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold dd-text">{{ t('agentsView.detail.overview.triggers') }}</span>
            <span class="text-2xs dd-text-muted">{{ props.agent.triggers.length }}</span>
          </div>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="triggerName in props.agent.triggers"
              :key="triggerName"
              class="px-1.5 py-0.5 dd-rounded text-2xs font-mono dd-bg-elevated dd-text-secondary"
            >
              {{ triggerName }}
            </span>
            <span v-if="props.agent.triggers.length === 0" class="text-2xs italic dd-text-muted">
              {{ t('agentsView.detail.overview.none') }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
