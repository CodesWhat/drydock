<script setup lang="ts">
interface InfoField {
  label: string;
  value: string;
}

interface LegacyInputSourceSummary {
  total: number;
  keys: string[];
}

interface LegacyInputSummary {
  total: number;
  env: LegacyInputSourceSummary;
  label: LegacyInputSourceSummary;
}

interface WebhookEndpoint {
  endpoint: string;
  description: string;
}

const props = defineProps<{
  loading: boolean;
  serverError: string;
  settingsError: string;
  hasLegacyCompatibilityInputs: boolean;
  legacyInputSummary: LegacyInputSummary | null;
  legacyEnvKeysPreview: string;
  legacyLabelKeysPreview: string;
  serverFields: InfoField[];
  storeFields: InfoField[];
  webhookEnabled: boolean;
  webhookEndpoints: WebhookEndpoint[];
  webhookExample: string;
  internetlessMode: boolean;
  settingsLoading: boolean;
  cacheClearing: boolean;
  cacheCleared: number | null;
}>();

const emit = defineEmits<{
  (e: 'toggle-internetless-mode'): void;
  (e: 'clear-icon-cache'): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="props.serverError"
      class="px-3 py-2 text-[0.6875rem] dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
    >
      {{ props.serverError }}
    </div>

    <div
      v-if="props.settingsError"
      class="px-3 py-2 text-[0.6875rem] dd-rounded"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
    >
      {{ props.settingsError }}
    </div>

    <div
      v-if="props.hasLegacyCompatibilityInputs"
      data-testid="legacy-input-banner"
      class="px-4 py-3 dd-rounded"
      :style="{
        backgroundColor: 'var(--dd-warning-muted)',
        border: '1px solid var(--dd-warning)',
      }"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-xs font-semibold" :style="{ color: 'var(--dd-warning)' }">
            Legacy compatibility inputs detected
          </div>
          <p class="text-[0.6875rem] dd-text-secondary mt-1">
            Deprecated <code class="font-mono">WUD_*</code> environment variables and
            <code class="font-mono">wud.*</code> labels are still in use.
          </p>
        </div>
        <span
          class="px-2 py-1 text-[0.625rem] font-semibold dd-rounded"
          :style="{
            backgroundColor: 'var(--dd-bg-card)',
            border: '1px solid var(--dd-warning)',
            color: 'var(--dd-warning)',
          }"
        >
          {{ props.legacyInputSummary?.total }} events
        </span>
      </div>
      <div class="mt-2 space-y-1.5 text-[0.625rem] dd-text-secondary">
        <div v-if="props.legacyInputSummary?.env.total">
          Env keys ({{ props.legacyInputSummary?.env.total }}):
          {{ props.legacyEnvKeysPreview }}
        </div>
        <div v-if="props.legacyInputSummary?.label.total">
          Label keys ({{ props.legacyInputSummary?.label.total }}):
          {{ props.legacyLabelKeysPreview }}
        </div>
      </div>
      <p class="mt-2 text-[0.625rem] dd-text-secondary">
        Run <code class="font-mono">node dist/index.js config migrate --dry-run</code> then
        <code class="font-mono">node dist/index.js config migrate --file &lt;path&gt;</code>.
        <a
          href="https://drydock.codeswhat.com/docs/quickstart"
          target="_blank"
          rel="noopener noreferrer"
          class="underline ml-1"
          :style="{ color: 'var(--dd-warning)' }"
        >Migration CLI docs</a>
      </p>
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
        <h2 class="text-sm font-semibold dd-text">Application</h2>
      </div>
      <div class="p-5 space-y-4">
        <div v-if="props.loading" class="flex items-center justify-center gap-2 text-xs dd-text-muted py-4">
          <AppIcon name="refresh" :size="12" class="animate-spin" />
          Loading server info
        </div>
        <template v-else>
          <div
            v-for="field in props.serverFields"
            :key="field.label"
            class="flex items-center justify-between py-2"
            :style="{ borderBottom: '1px solid var(--dd-border)' }"
          >
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
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
        <h2 class="text-sm font-semibold dd-text">Store</h2>
      </div>
      <div class="p-5 space-y-4">
        <div
          v-for="field in props.storeFields"
          :key="field.label"
          class="flex items-center justify-between py-2"
          :style="{ borderBottom: '1px solid var(--dd-border)' }"
        >
          <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">{{ field.label }}</span>
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
          <h2 class="text-sm font-semibold dd-text">Webhook API</h2>
        </div>
        <span
          class="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wider dd-rounded"
          :style="{
            backgroundColor: props.webhookEnabled ? 'var(--dd-success-muted)' : 'var(--dd-bg-inset)',
            color: props.webhookEnabled ? 'var(--dd-success)' : 'var(--dd-text-muted)',
            border: props.webhookEnabled
              ? '1px solid var(--dd-success)'
              : '1px solid var(--dd-border-strong)',
          }"
        >
          {{ props.webhookEnabled ? 'Enabled' : 'Disabled' }}
        </span>
      </div>
      <div class="p-5 space-y-4">
        <p class="text-[0.6875rem] dd-text-muted">
          Use these endpoints to trigger watch cycles and updates via HTTP.
          All requests require a Bearer token in the Authorization header.
        </p>
        <p v-if="!props.webhookEnabled" class="text-[0.6875rem] dd-text-muted">
          Webhook API is disabled. Set <code class="font-mono">DD_SERVER_WEBHOOK_ENABLED=true</code> and
          configure at least one token (<code class="font-mono">DD_SERVER_WEBHOOK_TOKEN</code> or
          <code class="font-mono">DD_SERVER_WEBHOOK_TOKENS_*</code>) to enable it.
        </p>
        <div class="overflow-x-auto dd-rounded">
          <table class="w-full text-left text-[0.6875rem]">
            <thead :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <tr>
                <th class="px-3 py-2 font-semibold uppercase tracking-wider dd-text-muted">Endpoint</th>
                <th class="px-3 py-2 font-semibold uppercase tracking-wider dd-text-muted">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in props.webhookEndpoints"
                :key="entry.endpoint"
                :style="{ borderTop: '1px solid var(--dd-border)' }"
              >
                <td class="px-3 py-2">
                  <code class="text-[0.6875rem] font-mono dd-text">{{ entry.endpoint }}</code>
                </td>
                <td class="px-3 py-2 dd-text-secondary">{{ entry.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted mb-1.5">Example</div>
          <pre
            class="px-3 py-2 text-[0.6875rem] font-mono dd-rounded overflow-x-auto"
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
        <h2 class="text-sm font-semibold dd-text">Network</h2>
      </div>
      <div class="p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold dd-text">Internetless Mode</div>
            <div class="text-[0.625rem] dd-text-muted mt-0.5">
              Block all outbound requests (container icons, external fetches)
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
        <h2 class="text-sm font-semibold dd-text">Container Icon Cache</h2>
      </div>
      <div class="p-5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold dd-text">Cached Icons</div>
            <div class="text-[0.625rem] dd-text-muted mt-0.5">
              Common icons are bundled; other icons are cached to disk on first fetch
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="props.cacheCleared !== null" class="text-[0.625rem] dd-text-success">
              {{ props.cacheCleared }} cleared
            </span>
            <button
              class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors"
              :class="props.cacheClearing ? 'opacity-50 pointer-events-none' : ''"
              :style="{
                backgroundColor: 'var(--dd-danger-muted)',
                color: 'var(--dd-danger)',
                border: '1px solid var(--dd-danger)',
              }"
              @click="emit('clear-icon-cache')"
            >
              <AppIcon name="trash" :size="10" class="mr-1" />
              Clear Cache
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
