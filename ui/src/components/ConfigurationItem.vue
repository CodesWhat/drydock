<template>
  <v-card rounded="lg" elevation="1">
    <v-card-title
      @click="collapse()"
      style="cursor: pointer"
      class="pa-4 d-flex align-center bg-surface"
    >
      <div class="d-flex align-center" style="gap: 12px">
        <div
          class="d-flex align-center justify-center flex-shrink-0"
          style="width: 40px"
        >
          <IconRenderer :icon="item.icon" :size="32" :margin-right="0" :color="iconColor || undefined" />
        </div>
        <div class="d-flex flex-column" style="min-width: 0">
          <span class="text-body-2 font-weight-medium text-truncate">{{ displayName }}</span>
          <div v-if="smAndUp" class="text-caption text-medium-emphasis d-flex align-center" style="gap: 4px">
            <span>{{ item.type }}</span>
            <template v-if="item.agent">
              <span>&middot;</span>
              <v-icon size="x-small" :color="agentStatusColor">fas fa-circle</v-icon>
              <span>{{ item.agent }}</span>
            </template>
          </div>
        </div>
      </div>
      <v-spacer />
      <v-icon>{{ showDetail ? "fas fa-chevron-up" : "fas fa-chevron-down" }}</v-icon>
    </v-card-title>
    <transition name="expand-transition">
      <v-card-text v-show="showDetail">
        <v-list density="compact" v-if="configurationItems.length > 0 || item.agent">
          <v-list-item v-if="item.agent">
            <v-list-item-title>Agent</v-list-item-title>
            <v-list-item-subtitle>
              <router-link to="/configuration/agents">
                {{ item.agent }}
              </router-link>
            </v-list-item-subtitle>
          </v-list-item>
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
      </v-card-text>
    </transition>
  </v-card>
</template>

<script lang="ts" src="./ConfigurationItem.ts"></script>
