<script setup lang="ts">
defineProps<{
  href?: string;
  label: string;
}>();
</script>

<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="min-w-0 dd-text hover:underline truncate"
    data-test="container-port-link"
    @click.stop
  >{{ label }}</a>
  <span v-else class="min-w-0 dd-text truncate" data-test="container-port-text">{{ label }}</span>
</template>
