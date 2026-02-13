<template>
  <v-navigation-drawer
    app
    :rail="!smAndDown && mini"
    :permanent="!smAndDown"
    :temporary="smAndDown"
    v-model="drawerModel"
    :disable-route-watcher="true"
    color="primary"
    theme="dark"
  >
    <div class="drawer-brand" :class="{ 'drawer-brand--rail': !smAndDown && mini }">
      <img :src="logo" alt="drydock logo" class="drawer-logo" />
      <template v-if="!mini || smAndDown">
        <span class="drawer-brand-text">DRYDOCK</span>
        <v-spacer />
      </template>
      <v-btn
        v-if="!smAndDown"
        icon
        variant="text"
        size="small"
        @click.stop="toggleDrawer"
        class="drawer-collapse-btn"
      >
        <v-icon size="small">{{ mini ? 'fas fa-angles-right' : 'fas fa-angles-left' }}</v-icon>
      </v-btn>
    </div>

    <v-divider />

    <v-list nav density="compact" class="pt-1 pb-1">
      <v-list-item to="/" prepend-icon="fas fa-house">
        <v-list-item-title>Home</v-list-item-title>
      </v-list-item>
      <v-list-item to="/containers" :prepend-icon="containerIcon">
        <v-list-item-title>Containers</v-list-item-title>
      </v-list-item>
    </v-list>

    <v-divider />

    <v-list nav density="compact" class="pt-2 pb-1">
      <v-list-subheader v-if="!mini || smAndDown" class="text-uppercase">
        Monitoring
      </v-list-subheader>
      <v-list-item
        v-for="item in monitoringItemsSorted"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
      >
        <v-list-item-title class="text-capitalize">{{ item.name }}</v-list-item-title>
      </v-list-item>
    </v-list>

    <v-divider />

    <v-list nav density="compact" class="pt-2 pb-1">
      <v-list-subheader v-if="!mini || smAndDown" class="text-uppercase">
        Configuration
      </v-list-subheader>
      <v-list-item
        v-for="item in configurationItemsSorted"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
      >
        <v-list-item-title class="text-capitalize">{{ item.name }}</v-list-item-title>
      </v-list-item>
    </v-list>

    <template v-slot:append v-if="!mini || smAndDown">
      <div class="drawer-version">
        v{{ version }}
      </div>
    </template>
  </v-navigation-drawer>
</template>
<script lang="ts" src="./NavigationDrawer.ts"></script>
<style scoped>
.drawer-brand {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 10px;
  min-height: 48px;
}

.drawer-brand--rail {
  flex-direction: column;
  padding: 8px 0;
  gap: 4px;
  justify-content: center;
  align-items: center;
}

.drawer-logo {
  height: 28px;
  width: auto;
  flex-shrink: 0;
}

.drawer-brand--rail .drawer-logo {
  height: 32px;
}

.drawer-brand-text {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.95);
  white-space: nowrap;
}

.drawer-collapse-btn {
  color: rgba(255, 255, 255, 0.7);
  flex-shrink: 0;
}

/* Override Vuetify grid to reduce icon-to-text gap */
::v-deep(.v-list-item) {
  grid-template-columns: 42px 1fr auto !important;
  padding-inline-start: 16px !important;
}

::v-deep(.v-list-item .v-list-item__prepend) {
  justify-content: center;
}

::v-deep(.v-list-item .v-list-item__prepend > .v-icon) {
  margin-inline-end: 0 !important;
}

/* Rail mode: center icons */
::v-deep(.v-navigation-drawer--rail .v-list-item) {
  grid-template-columns: 1fr !important;
  justify-items: center;
  padding-inline: 0 !important;
}

::v-deep(.v-navigation-drawer--rail .v-list-item .v-list-item__prepend) {
  margin-inline-end: 0 !important;
}

.drawer-version {
  padding: 8px 16px 12px;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
}
</style>
