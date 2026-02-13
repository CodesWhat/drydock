<template>
  <v-app class="main-background">
    <self-update-overlay />

    <snack-bar
      :message="snackbarMessage"
      :show="snackbarShow"
      :level="snackbarLevel"
    />

    <navigation-drawer v-if="authenticated" v-model="drawerVisible" />

    <app-bar
      v-if="authenticated"
      :user="user"
      :show-menu-toggle="smAndDown"
      @toggle-drawer="toggleDrawer"
    />

    <v-main scrollable>
      <router-view></router-view>
    </v-main>
  </v-app>
</template>

<script lang="ts" src="./App.ts"></script>

<style>
.v-application {
  font-family: 'IBM Plex Mono', monospace !important;
}
</style>
