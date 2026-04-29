<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppBadge from '@/components/AppBadge.vue';

const { t } = useI18n();

interface InfoField {
  label: string;
  value: string;
}

interface WebhookEndpoint {
  endpoint: string;
  description: string;
}

const props = defineProps<{
  loading: boolean;
  serverError: string;
  settingsError: string;
  serverFields: InfoField[];
  storeFields: InfoField[];
  webhookEnabled: boolean;
  webhookEndpoints: WebhookEndpoint[];
  webhookExample: string;
  internetlessMode: boolean;
  settingsLoading: boolean;
  cacheClearing: boolean;
  cacheCleared: number | null;
  debugDumpDownloading: boolean;
  debugDumpError: string;
}>();

const emit = defineEmits<{
  (e: 'toggle-internetless-mode'): void;
  (e: 'clear-icon-cache'): void;
  (e: 'download-debug-dump'): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="props.serverError"
      class="px-3 py-2 text-2xs-plus dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
    >
      {{ props.serverError }}
    </div>

    <div
      v-if="props.settingsError"
      class="px-3 py-2 text-2xs-plus dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
    >
      {{ props.settingsError }}
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div
        class="px-5 py-3.5 flex items-center gap-2"
      >
        <AppIcon name="settings" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('configView.general.application.title') }}</h2>
      </div>
      <div class="p-5 space-y-4">
        <div v-if="props.loading" class="flex items-center justify-center gap-2 text-xs dd-text-muted py-4">
          <AppIcon name="refresh" :size="12" class="animate-spin" />
          {{ t('configView.general.application.loadingServerInfo') }}
        </div>
        <template v-else>
          <div
            v-for="field in props.serverFields"
            :key="field.label"
            class="flex items-center justify-between py-2"
            :style="{ borderBottom: '1px solid var(--dd-border)' }"
          >
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ field.value }}</span>
          </div>
        </template>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div
        class="px-5 py-3.5 flex items-center gap-2"
      >
        <AppIcon name="server" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('configView.general.store.title') }}</h2>
      </div>
      <div class="p-5 space-y-4">
        <div
          v-for="field in props.storeFields"
          :key="field.label"
          class="flex items-center justify-between py-2"
          :style="{ borderBottom: '1px solid var(--dd-border)' }"
        >
          <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
          <span class="text-xs font-medium font-mono dd-text">{{ field.value }}</span>
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div
        class="px-5 py-3.5 flex items-center justify-between gap-3"
      >
        <div class="flex items-center gap-2">
          <AppIcon name="bolt" :size="14" class="text-drydock-secondary" />
          <h2 class="dd-text-heading-section dd-text">{{ t('configView.general.webhookApi.title') }}</h2>
        </div>
        <AppBadge :tone="props.webhookEnabled ? 'success' : 'neutral'">
          {{ props.webhookEnabled ? t('configView.general.webhookApi.enabled') : t('configView.general.webhookApi.disabled') }}
        </AppBadge>
      </div>
      <div class="p-5 space-y-4">
        <p class="text-2xs-plus dd-text-muted">
          {{ t('configView.general.webhookApi.description') }}
        </p>
        <p v-if="!props.webhookEnabled" class="text-2xs-plus dd-text-muted">
          {{ t('configView.general.webhookApi.disabledMessage') }} <code class="font-mono">DD_SERVER_WEBHOOK_ENABLED=true</code> and
          configure at least one token (<code class="font-mono">DD_SERVER_WEBHOOK_TOKEN</code> or
          <code class="font-mono">DD_SERVER_WEBHOOK_TOKENS_*</code>) to enable it.
        </p>
        <div class="overflow-x-auto dd-rounded">
          <table class="w-full text-left text-2xs-plus">
            <thead :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <tr>
                <th class="px-3 py-2 font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.general.webhookApi.table.endpoint') }}</th>
                <th class="px-3 py-2 font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.general.webhookApi.table.description') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in props.webhookEndpoints"
                :key="entry.endpoint"
                :style="{ borderTop: '1px solid var(--dd-border)' }"
              >
                <td class="px-3 py-2">
                  <code class="text-2xs-plus font-mono dd-text">{{ entry.endpoint }}</code>
                </td>
                <td class="px-3 py-2 dd-text-secondary">{{ entry.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted mb-1.5">{{ t('configView.general.webhookApi.example') }}</div>
          <pre
            class="px-3 py-2 text-2xs-plus font-mono dd-rounded overflow-x-auto"
            :style="{
              backgroundColor: 'var(--dd-bg-inset)',
              color: 'var(--dd-text)',
            }"
          >{{ props.webhookExample }}</pre>
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div
        class="px-5 py-3.5 flex items-center gap-2"
      >
        <AppIcon name="globe" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('configView.general.network.title') }}</h2>
      </div>
      <div class="p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold dd-text">{{ t('configView.general.network.internetlessMode.label') }}</div>
            <div class="text-2xs dd-text-muted mt-0.5">
              {{ t('configView.general.network.internetlessMode.description') }}
            </div>
          </div>
          <ToggleSwitch
            :model-value="props.internetlessMode"
            :disabled="props.settingsLoading"
            @update:model-value="emit('toggle-internetless-mode')"
          />
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div
        class="px-5 py-3.5 flex items-center gap-2"
      >
        <AppIcon name="containers" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('configView.general.iconCache.title') }}</h2>
      </div>
      <div class="p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold dd-text">{{ t('configView.general.iconCache.cachedIcons.label') }}</div>
            <div class="text-2xs dd-text-muted mt-0.5">
              {{ t('configView.general.iconCache.cachedIcons.description') }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="props.cacheCleared !== null" class="text-2xs dd-text-success">
              {{ t('configView.general.iconCache.cleared', { count: props.cacheCleared }) }}
            </span>
            <AppButton size="none" variant="plain" weight="none"
              class="px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
              :class="props.cacheClearing ? 'opacity-50 pointer-events-none' : ''"
              :style="{
                backgroundColor: 'var(--dd-danger-muted)',
                color: 'var(--dd-danger)',
                border: '1px solid var(--dd-danger)',
              }"
              @click="emit('clear-icon-cache')"
            >
              <AppIcon name="trash" :size="10" class="mr-1" />
              {{ t('configView.general.iconCache.clearButton') }}
            </AppButton>
          </div>
        </div>
      </div>
    </div>

    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div
        class="px-5 py-3.5 flex items-center gap-2"
      >
        <AppIcon name="download" :size="14" class="text-drydock-secondary" />
        <h2 class="dd-text-heading-section dd-text">{{ t('configView.general.diagnostics.title') }}</h2>
      </div>
      <div class="p-5 space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs font-semibold dd-text">{{ t('configView.general.diagnostics.debugDump.label') }}</div>
            <div class="text-2xs dd-text-muted mt-0.5">
              {{ t('configView.general.diagnostics.debugDump.description') }}
            </div>
          </div>
          <AppButton
            data-test="download-debug-dump"
            size="none"
            variant="plain"
            weight="none"
            class="px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
            :class="props.debugDumpDownloading ? 'opacity-50 pointer-events-none' : ''"
            :style="{
              backgroundColor: 'var(--dd-bg-inset)',
              color: 'var(--dd-text)',
              border: '1px solid var(--dd-border-strong)',
            }"
            @click="emit('download-debug-dump')"
          >
            <AppIcon :name="props.debugDumpDownloading ? 'spinner' : 'download'" :size="10" class="mr-1" :class="props.debugDumpDownloading ? 'dd-spin' : ''" />
            {{ props.debugDumpDownloading ? t('configView.general.diagnostics.debugDump.preparing') : t('configView.general.diagnostics.debugDump.download') }}
          </AppButton>
        </div>
        <div v-if="props.debugDumpError" class="text-2xs" :style="{ color: 'var(--dd-danger)' }">
          {{ props.debugDumpError }}
        </div>
      </div>
    </div>
  </div>
</template>
