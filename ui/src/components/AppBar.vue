<template>
  <v-app-bar app flat dark tile clipped-left dense color="primary">
    <img :src="logo" alt="WUD logo" class="app-logo" />
    <v-toolbar-title
      v-if="viewName && 'home'.toLowerCase() !== viewName.toLowerCase()"
      class="text-body-1 text-capitalize ma-0 pl-4"
      >{{ viewName }}</v-toolbar-title
    >
    <v-spacer />
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
          <v-icon size="small">mdi-account</v-icon>
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
<script>
import { computed, inject } from "vue";
import { useRoute, useRouter } from "vue-router";
import { logout } from "@/services/auth";
import logo from "@/assets/whale-logo.png";

export default {
  props: {
    user: {
      type: Object,
      required: true,
    },
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const eventBus = inject("eventBus");

    const viewName = computed(() => {
      return route.name;
    });

    const performLogout = async () => {
      try {
        const logoutResult = await logout();
        if (logoutResult.logoutUrl) {
          window.location = logoutResult.logoutUrl;
        } else {
          await router.push({
            name: "login",
          });
        }
      } catch (e) {
        eventBus.emit(
          "notify",
          `Error when trying to logout (${e.message})`,
          "error",
        );
      }
    };

    return {
      logo,
      viewName,
      logout: performLogout,
    };
  },
};
</script>
<style scoped>
.app-logo {
  height: 30px;
  width: auto;
  margin-left: 12px;
}
</style>
