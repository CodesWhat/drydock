<template>
  <v-app class="main-background">
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

<style scoped>
.main-background {
  /* background-color: #f5f5f5; */
}
</style>
