<template>
  <v-list density="compact">
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-triangle-exclamation</v-icon>
      </template>
      <v-list-item-title>Error</v-list-item-title>
      <v-list-item-subtitle>
        {{ error.message }}
      </v-list-item-subtitle>
    </v-list-item>
  </v-list>
</template>

<script lang="ts" src="./ContainerError.ts"></script>
