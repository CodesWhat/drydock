<template>
  <v-container fluid>
    <v-row v-for="watcher in watchers" :key="watcher.name">
      <v-col :cols="12" class="pt-2 pb-2">
        <configuration-item :item="watcher" />
        <v-card
          v-if="
            watcher.configuration &&
            watcher.configuration.cron &&
            schedulerByWatcher[watcher.id]
          "
          class="mt-2 pa-3"
          variant="outlined"
        >
          <div class="d-flex align-center flex-wrap ga-2 mb-2">
            <v-chip color="secondary" variant="tonal" size="small" label>
              Scheduler helper
            </v-chip>
            <span class="text-body-2">{{
              humanizeCron(schedulerByWatcher[watcher.id]?.cron)
            }}</span>
          </div>

          <v-row dense>
            <v-col cols="12" md="3">
              <v-select
                :items="scheduleModes"
                item-title="label"
                item-value="value"
                label="Schedule"
                hide-details
                variant="outlined"
                density="compact"
                v-model="schedulerByWatcher[watcher.id].mode"
                @update:modelValue="onSchedulerFieldChange(watcher)"
              />
            </v-col>
            <v-col cols="6" md="2">
              <v-text-field
                type="number"
                label="Minute"
                hide-details
                variant="outlined"
                density="compact"
                :min="0"
                :max="59"
                v-model.number="schedulerByWatcher[watcher.id].minute"
                @update:modelValue="onSchedulerFieldChange(watcher)"
              />
            </v-col>
            <v-col cols="6" md="2" v-if="schedulerByWatcher[watcher.id].mode === 'every-n-hours'">
              <v-text-field
                type="number"
                label="Every N hours"
                hide-details
                variant="outlined"
                density="compact"
                :min="1"
                :max="23"
                v-model.number="schedulerByWatcher[watcher.id].intervalHours"
                @update:modelValue="onSchedulerFieldChange(watcher)"
              />
            </v-col>
            <v-col
              cols="6"
              md="2"
              v-if="
                schedulerByWatcher[watcher.id].mode === 'daily' ||
                schedulerByWatcher[watcher.id].mode === 'weekly'
              "
            >
              <v-text-field
                type="number"
                label="Hour"
                hide-details
                variant="outlined"
                density="compact"
                :min="0"
                :max="23"
                v-model.number="schedulerByWatcher[watcher.id].hour"
                @update:modelValue="onSchedulerFieldChange(watcher)"
              />
            </v-col>
            <v-col cols="6" md="3" v-if="schedulerByWatcher[watcher.id].mode === 'weekly'">
              <v-select
                :items="weekDays"
                item-title="label"
                item-value="value"
                label="Day"
                hide-details
                variant="outlined"
                density="compact"
                v-model="schedulerByWatcher[watcher.id].weekday"
                @update:modelValue="onSchedulerFieldChange(watcher)"
              />
            </v-col>
            <v-col cols="12" md="5" v-if="schedulerByWatcher[watcher.id].mode === 'custom'">
              <v-text-field
                label="CRON expression"
                hide-details
                variant="outlined"
                density="compact"
                v-model="schedulerByWatcher[watcher.id].cron"
                @update:modelValue="onSchedulerFieldChange(watcher)"
              />
            </v-col>
          </v-row>

          <div class="d-flex align-center flex-wrap ga-2 mt-3">
            <v-btn
              size="small"
              variant="outlined"
              @click="copyCron(watcher)"
            >
              Copy CRON
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              @click="copyWatcherEnvVar(watcher)"
            >
              Copy env var
            </v-btn>
            <span class="text-caption text-medium-emphasis">
              Helper only: update your deployment env and restart.
            </span>
          </div>

          <v-alert
            density="compact"
            class="mt-2"
            variant="tonal"
            color="info"
            icon="mdi-code-json"
          >
            watcher.configuration.cron = {{ watcher.configuration.cron }}
          </v-alert>
        </v-card>
      </v-col>
    </v-row>
    <v-row v-if="watchers.length === 0">
      <v-card-subtitle class="text-h6">No watchers configured</v-card-subtitle>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationWatchersView.ts"></script>
