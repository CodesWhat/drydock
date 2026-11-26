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

onMounted(() => {
  void loadContainers().catch(() => undefined);
});
</script>

<template>
  <div class="min-w-0 w-full">
    <FleetHealthBar :health="health" />
  </div>
</template>
