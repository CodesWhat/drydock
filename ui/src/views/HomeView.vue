<template>
  <v-container>
    <v-row class="d-md-flex pa-md-15 ma-md-15">
      <v-col xs="12" sm="12" md="6" lg="3" xl="3">
        <div class="home-card-wrapper">
          <v-card class="home-card text-center d-flex flex-column align-center" variant="outlined">
            <v-icon color="secondary" class="home-icon">{{
              containerIcon
            }}</v-icon>
            <v-btn variant="plain" size="x-large" to="/containers"
              >{{ containersCount }} containers</v-btn
            >
          </v-card>
          <v-chip
            size="small"
            variant="elevated"
            class="home-status-chip"
            :color="containersToUpdateCount > 0 ? 'warning' : 'success'"
            :to="containersToUpdateCount > 0 ? '/containers?update-available=true' : undefined"
            >{{ containerUpdateMessage }}</v-chip
          >
        </div>
      </v-col>
      <v-col xs="12" sm="12" md="6" lg="3" xl="3">
        <v-card class="home-card text-center d-flex flex-column align-center" variant="outlined">
          <v-icon color="secondary" class="home-icon">{{ triggerIcon }}</v-icon>
          <v-btn variant="plain" size="x-large" to="/configuration/triggers"
            >{{ triggersCount }} triggers</v-btn
          >
        </v-card>
      </v-col>
      <v-col xs="12" sm="12" md="6" lg="3" xl="3">
        <v-card class="home-card text-center d-flex flex-column align-center" variant="outlined">
          <v-icon color="secondary" class="home-icon">{{ watcherIcon }}</v-icon>
          <v-btn variant="plain" size="x-large" to="/configuration/watchers"
            >{{ watchersCount }} watchers</v-btn
          >
        </v-card>
      </v-col>
      <v-col xs="12" sm="12" md="6" lg="3" xl="3">
        <v-card class="home-card text-center d-flex flex-column align-center" variant="outlined">
          <v-icon color="secondary" class="home-icon">{{
            registryIcon
          }}</v-icon>
          <v-btn variant="plain" size="x-large" to="/configuration/registries"
            >{{ registriesCount }} registries</v-btn
          >
        </v-card>
      </v-col>
    </v-row>
    <v-row class="d-md-flex pa-md-15 ma-md-15" style="margin-top: -40px !important;">
      <v-col cols="12" md="6">
        <v-card variant="outlined" class="h-100">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2" color="secondary">fas fa-clock-rotate-left</v-icon>
            Recent Activity
          </v-card-title>
          <v-card-text class="text-center text-medium-emphasis py-8">
            <v-icon size="48" color="grey">fas fa-clock-rotate-left</v-icon>
            <div class="mt-4">No activity recorded yet</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card variant="outlined" class="h-100">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2" color="secondary">fas fa-calendar-check</v-icon>
            Maintenance Windows
          </v-card-title>
          <v-card-text class="text-center text-medium-emphasis py-8">
            <v-icon size="48" color="grey">fas fa-calendar-check</v-icon>
            <div class="mt-4">No maintenance windows configured</div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./HomeView.ts"></script>
<style scoped>
.home-card-wrapper {
  position: relative;
  height: 100%;
}

.home-card {
  height: 100%;
}

.home-status-chip {
  position: absolute;
  top: -10px;
  right: -8px;
  z-index: 1;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.home-icon {
  font-size: 80px;
}
</style>
