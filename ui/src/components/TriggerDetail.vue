<template>
  <v-card variant="outlined" rounded="lg">
    <v-card-title
      @click="collapse()"
      style="cursor: pointer"
      class="pa-3 d-flex align-center bg-surface"
    >
      <div class="text-body-3">
        <v-chip label color="info" variant="outlined">{{ trigger.type }}</v-chip>
        /
        <v-chip label color="info" variant="outlined">{{ trigger.name }}</v-chip>
      </div>
      <v-spacer />
      <v-icon>{{ trigger.icon }}</v-icon>
      <v-icon>{{ showDetail ? "fas fa-chevron-up" : "fas fa-chevron-down" }}</v-icon>
    </v-card-title>
    <transition name="expand-transition">
      <v-card-text v-show="showDetail">
        <v-row>
          <v-col cols="8">
            <v-list density="compact" v-if="configurationItems.length > 0">
              <v-list-item
                v-for="configurationItem in configurationItems"
                :key="configurationItem.key"
              >
                <v-list-item-title class="text-capitalize">{{
                  configurationItem.key
                }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ formatValue(configurationItem.value) }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
            <span v-else>Default configuration</span>
          </v-col>
          <v-col cols="4" class="text-right">
            <v-btn variant="outlined" size="small" color="accent" @click="openTestForm">
              Test
              <v-icon end>fas fa-flask</v-icon>
            </v-btn>

            <v-navigation-drawer
              v-model="showTestForm"
              location="right"
              temporary
              width="400"
              style="position: absolute;"
            >
              <div class="pa-3">
                <div class="text-subtitle-2 mb-2">
                  <v-icon size="small">fas fa-flask</v-icon>
                  Test trigger
                </div>
                <v-select
                  label="Container"
                  v-model="selectedContainerId"
                  :items="testContainers"
                  item-title="displayName"
                  item-value="id"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="mb-3"
                >
                  <template #item="{ props, item }">
                    <v-list-item v-bind="props">
                      <v-list-item-title>
                        {{ item.raw.displayName || item.raw.name }}
                      </v-list-item-title>
                      <v-list-item-subtitle>
                        {{ item.raw.name }} • {{ item.raw.watcher }}
                      </v-list-item-subtitle>
                    </v-list-item>
                  </template>
                  <template #selection="{ item }">
                    <span>
                      {{ item.raw.displayName || item.raw.name }}
                    </span>
                  </template>
                </v-select>
                <div v-if="testContainers.length === 0" class="text-caption mb-3">
                  No local containers available for testing. Remote containers cannot be
                  used for trigger tests.
                </div>
                <v-btn
                  variant="outlined"
                  size="small"
                  color="accent"
                  block
                  @click="runTrigger"
                  :loading="isTriggering"
                  >Run trigger</v-btn
                >
              </div>
            </v-navigation-drawer>
          </v-col>
        </v-row>
      </v-card-text>
    </transition>
  </v-card>
</template>

<script lang="ts" src="./TriggerDetail.ts"></script>
