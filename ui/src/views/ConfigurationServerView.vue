<template>
  <v-container fluid class="pa-4">
    <div class="mb-2">
      <configuration-item :item="serverConfiguration" />
    </div>
    <div class="mb-2">
      <configuration-item :item="logConfiguration" />
    </div>
    <div class="mb-2">
      <configuration-item :item="storeConfiguration" />
    </div>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationServerView.ts"></script>
