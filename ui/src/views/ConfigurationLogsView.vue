<template>
  <v-container fluid class="pa-4">
    <configuration-item :item="configurationItem" />
    <v-card variant="outlined" rounded="lg">
      <v-card-title>
        <v-icon class="mr-2">fas fa-file-lines</v-icon>
        Application Logs
      </v-card-title>
      <v-card-text class="pa-0">
        <application-logs :configured-level="log.level" />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationLogsView.ts"></script>
