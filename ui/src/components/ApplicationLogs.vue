<template>
  <div class="app-logs">
    <div class="app-logs__toolbar d-flex align-center pa-2" style="gap: 8px">
      <v-select
        v-if="agents.length"
        v-model="source"
        :items="sourceItems"
        item-title="title"
        item-value="value"
        label="Source"
        density="compact"
        hide-details
        variant="outlined"
        style="max-width: 180px"
      />
      <v-select
        v-model="level"
        :items="['all', 'debug', 'info', 'warn', 'error']"
        label="Level"
        density="compact"
        hide-details
        variant="outlined"
        style="max-width: 130px"
      />
      <v-tooltip v-if="configuredLevel" location="bottom">
        <template v-slot:activator="{ props }">
          <v-icon v-bind="props" size="small" color="grey">fas fa-circle-info</v-icon>
        </template>
        Your server log level is set to "{{ configuredLevel.toUpperCase() }}". Logs below this level won't appear here.
      </v-tooltip>
      <v-select
        v-model="tail"
        :items="[50, 100, 500, 1000]"
        label="Lines"
        density="compact"
        hide-details
        variant="outlined"
        style="max-width: 130px"
      />
      <v-btn
        icon
        size="small"
        variant="text"
        :loading="loading"
        @click="fetchEntries"
      >
        <v-icon>fas fa-arrows-rotate</v-icon>
      </v-btn>
    </div>

    <div v-if="loading && !entries.length" class="d-flex justify-center pa-4">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <v-alert v-else-if="error" type="error" class="ma-2">
      {{ error }}
    </v-alert>

    <section
      v-else-if="entries.length"
      ref="logPre"
      class="app-logs__terminal ma-2"
      aria-label="Application log output"
    ><pre><span v-for="(entry, i) in entries" :key="i" :style="{ color: levelColor(entry.level) }">{{ new Date(entry.timestamp).toISOString() }} [{{ entry.level.toUpperCase().padEnd(5) }}] [{{ entry.component }}] {{ entry.msg }}
</span></pre></section>

    <div v-else class="app-logs__empty text-center pa-6 text-medium-emphasis">
      <v-icon size="32" class="mb-2" color="grey">fas fa-file-circle-xmark</v-icon>
      <div>No log entries</div>
    </div>
  </div>
</template>

<script lang="ts" src="./ApplicationLogs.ts"></script>

<style scoped>
.app-logs__toolbar {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.app-logs__terminal {
  background-color: #1e1e1e;
  color: #d4d4d4;
  max-height: 500px;
  overflow-y: auto;
  border-radius: 6px;
  padding: 12px;
}

.app-logs__terminal pre {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  margin: 0;
  color: inherit;
}

.app-logs__empty {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
</style>
