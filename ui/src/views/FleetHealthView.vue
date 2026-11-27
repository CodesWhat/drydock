<script setup lang="ts">
import { onMounted, ref } from 'vue';
import FleetHealthBar from '../components/containers/FleetHealthBar.vue';
import { getAllContainers } from '../services/container';
import type { Container } from '../types/container';
import { mapApiContainers } from '../utils/container-mapper';
import { useI18n } from 'vue-i18n';
import { useFleetHealth } from './containers/useFleetHealth';

const { t } = useI18n();
const containers = ref<Container[]>([]);
const inventoryAvailable = ref(false);
const busy = ref(false);

async function loadContainers() {
  busy.value = true;
  try {
    containers.value = mapApiContainers(await getAllContainers(), t);
    inventoryAvailable.value = true;
  } catch (error) {
    inventoryAvailable.value = false;
    throw error;
  } finally {
    busy.value = false;
  }
}

const health = useFleetHealth({ containers, inventoryAvailable, busy, loadContainers });

const fleet = {
  ...health,
  load: () =>
    Promise.all([
      health.load(),
      inventoryAvailable.value || busy.value ? undefined : loadContainers().catch(() => undefined),
    ]).then(() => undefined),
};

onMounted(() => {
  void loadContainers().catch(() => undefined);
});
</script>

<template>
  <div class="min-w-0 w-full flex-1 min-h-0 overflow-y-auto">
    <FleetHealthBar :health="fleet" />
  </div>
</template>
