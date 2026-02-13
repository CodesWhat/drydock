<template>
  <v-card rounded="lg" elevation="1">
    <v-card-title
      @click="collapse()"
      style="cursor: pointer"
      class="pa-4 d-flex align-center bg-surface"
    >
      <div class="d-flex align-center" style="gap: 12px">
        <div class="d-flex align-center justify-center flex-shrink-0" style="width: 32px">
          <v-icon :size="24" :color="trigger.iconColor || undefined">{{ trigger.icon }}</v-icon>
        </div>
        <div class="d-flex flex-column" style="min-width: 0">
          <span class="text-body-2 font-weight-medium text-truncate">{{ trigger.name }}</span>
          <span class="text-caption text-medium-emphasis">{{ trigger.type }}</span>
        </div>
      </div>
      <v-spacer />
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
