<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIconButton from '../components/AppIconButton.vue';
import ContainerLogs from '../components/containers/ContainerLogs.vue';
import { getAllContainers } from '../services/container';
import type { Container } from '../types/container';
import { mapApiContainer } from '../utils/container-mapper';
import { ROUTES } from '../router/routes';

const route = useRoute();
const router = useRouter();

const containerId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' ? raw : Array.isArray(raw) ? (raw[0] ?? '') : '';
});

const container = ref<Container | null>(null);
const loading = ref(true);
const error = ref('');

async function loadContainer() {
  loading.value = true;
  error.value = '';
  try {
    const all = await getAllContainers();
    const match = all.find((c) => c.id === containerId.value || c.name === containerId.value);
    if (match) {
      container.value = mapApiContainer(match);
    } else {
      error.value = `Container "${containerId.value}" not found`;
    }
  } catch {
    error.value = 'Failed to load container info';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadContainer();
});

const containerName = computed(() => container.value?.name ?? containerId.value);
const containerImage = computed(() => container.value?.image ?? '');
const containerStatus = computed(() => container.value?.status ?? 'unknown');

function goBack() {
  router.push(ROUTES.CONTAINERS);
}
</script>

<template>
  <div class="flex-1 min-h-0 min-w-0 overflow-y-auto pr-2 sm:pr-[15px]">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-3">
      <AppIconButton
        icon="arrow-left"
        size="toolbar"
        variant="plain"
        class="dd-text-muted hover:dd-text"
        tooltip="Back to containers"
        aria-label="Back to containers"
        @click="goBack"
      />

      <div class="flex flex-col gap-0.5 min-w-0">
        <div class="flex items-center gap-2">
          <h1 class="text-sm font-bold dd-text truncate">{{ containerName }}</h1>
          <span
            v-if="!loading"
            class="shrink-0 px-1.5 py-0.5 dd-rounded text-3xs font-bold uppercase tracking-wider"
            :style="{
              backgroundColor: containerStatus === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
              color: containerStatus === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
            }"
          >{{ containerStatus }}</span>
        </div>
        <span v-if="containerImage" class="text-2xs dd-text-muted truncate">{{ containerImage }}</span>
      </div>

      <div class="ml-auto text-2xs-plus font-semibold dd-text-muted uppercase tracking-wider">
        Container Logs
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center dd-text-muted text-xs">
      Loading container...
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="px-4 py-3 dd-rounded text-2xs-plus"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
    >
      {{ error }}
    </div>

    <!-- Log viewer (full height) -->
    <ContainerLogs
      v-else
      class="flex-1 min-h-0"
      :container-id="containerId"
      :container-name="containerName"
    />
  </div>
</template>
