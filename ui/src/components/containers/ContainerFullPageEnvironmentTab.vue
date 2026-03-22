<script setup lang="ts">
import { reactive, ref } from 'vue';
import AppButton from '../AppButton.vue';
import { revealContainerEnv } from '../../services/container';
import { errorMessage } from '../../utils/error';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

interface RevealEnvResponse {
  env?: Array<{ key: string; value: string }>;
}

const revealedEnvCache = reactive(new Map<string, Map<string, string>>());
const revealedKeys = reactive(new Set<string>());
const envRevealLoading = ref(false);

function revealCacheKey(containerId: string, key: string) {
  return `${containerId}:${key}`;
}

async function toggleReveal(containerId: string, key: string) {
  const cacheKey = revealCacheKey(containerId, key);

  if (revealedKeys.has(cacheKey)) {
    revealedKeys.delete(cacheKey);
    return;
  }

  const cached = revealedEnvCache.get(containerId);
  if (cached?.has(key)) {
    revealedKeys.add(cacheKey);
    return;
  }

  envRevealLoading.value = true;
  try {
    const result: RevealEnvResponse = await revealContainerEnv(containerId);
    const envMap = new Map<string, string>();
    for (const entry of result.env || []) {
      envMap.set(entry.key, entry.value);
    }
    revealedEnvCache.set(containerId, envMap);
    revealedKeys.add(cacheKey);
  } catch (error: unknown) {
    void errorMessage(error);
    // silently fail - user can retry
  } finally {
    envRevealLoading.value = false;
  }
}

function getRevealedValue(containerId: string, key: string): string | undefined {
  const cacheKey = revealCacheKey(containerId, key);
  if (!revealedKeys.has(cacheKey)) return undefined;
  return revealedEnvCache.get(containerId)?.get(key);
}

const { selectedContainer } = useContainersViewTemplateContext();
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="dd-rounded overflow-hidden"
          :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-4 py-3 flex items-center gap-2">
        <AppIcon name="config" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Environment Variables</span>
        <span class="badge text-3xs ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.env.length }}</span>
      </div>
      <div class="p-4">
        <div v-if="selectedContainer.details.env.length > 0" class="space-y-1.5">
          <div v-for="e in selectedContainer.details.env" :key="e.key"
                class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <span class="font-semibold shrink-0 text-drydock-secondary">{{ e.key }}</span>
            <span class="dd-text-muted">=</span>
            <span v-if="!e.sensitive" class="truncate dd-text">{{ e.value }}</span>
            <template v-else>
              <span v-if="getRevealedValue(selectedContainer.id, e.key)" class="truncate dd-text">{{ getRevealedValue(selectedContainer.id, e.key) }}</span>
              <span v-else class="truncate dd-text-muted">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span>
              <AppButton size="none" variant="plain" weight="none" class="shrink-0 p-0.5 dd-text-muted hover:dd-text transition-colors"
                      :disabled="envRevealLoading"
                      @click="toggleReveal(selectedContainer.id, e.key)">
                <AppIcon :name="getRevealedValue(selectedContainer.id, e.key) ? 'eye-slash' : 'eye'" :size="11" />
              </AppButton>
            </template>
          </div>
        </div>
        <p v-else class="text-xs dd-text-muted italic">No environment variables configured</p>
      </div>
    </div>
    <div class="dd-rounded overflow-hidden"
          :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-4 py-3 flex items-center gap-2">
        <AppIcon name="hard-drive" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Volumes</span>
        <span class="badge text-3xs ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.volumes.length }}</span>
      </div>
      <div class="p-4">
        <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1.5">
          <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <AppIcon name="hard-drive" :size="10" class="dd-text-muted" />
            <span class="truncate dd-text">{{ vol }}</span>
          </div>
        </div>
        <p v-else class="text-xs dd-text-muted italic">No volumes mounted</p>
      </div>
    </div>
  </div>
</template>
