<template>
  <v-app-bar app flat dense color="surface" elevation="1">
    <v-app-bar-nav-icon v-if="showMenuToggle" @click.stop="$emit('toggle-drawer')">
      <v-icon>fas fa-bars</v-icon>
    </v-app-bar-nav-icon>
    <img
      v-if="showMenuToggle"
      :src="logo"
      alt="drydock"
      class="appbar-logo"
      :class="{ 'appbar-logo--invert': isDark }"
    />
    <v-toolbar-title
      v-if="viewName && 'home'.toLowerCase() !== viewName.toLowerCase()"
      class="text-body-1 text-capitalize ma-0 pl-4"
      >{{ viewName }}</v-toolbar-title
    >
    <v-spacer />

    <v-tooltip :text="'Theme: ' + themeLabel" location="bottom">
      <template v-slot:activator="{ props }">
        <v-btn icon variant="text" size="small" v-bind="props" @click="cycleTheme">
          <v-icon size="small" :color="themeIconColor">{{ themeIcon }}</v-icon>
        </v-btn>
      </template>
    </v-tooltip>

    <v-menu v-if="user && user.username !== 'anonymous'">
      <template v-slot:activator="{ props }">
        <v-btn
          v-bind="props"
          variant="text"
          size="small"
          class="text-lowercase"
        >
          {{ user.username }}
          &nbsp;
          <v-icon size="small">fas fa-user</v-icon>
        </v-btn>
      </template>
      <v-list density="compact">
        <v-list-item @click="logout">
          <v-list-item-title class="text-body-2">Log out</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </v-app-bar>
</template>
<script lang="ts" src="./AppBar.ts"></script>

<style scoped>
.appbar-logo {
  height: 24px;
  width: auto;
  margin-left: 4px;
  transition: filter 0.3s ease;
}

.appbar-logo--invert {
  filter: invert(1);
}
</style>
