<script setup lang="ts">
import { useGlobalUpdateToast } from './composables/useGlobalUpdateToast';

useGlobalUpdateToast();
</script>

<template>
  <router-view />
  <ConfirmDialog />
  <AppToast />
</template>
