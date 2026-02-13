<template>
  <v-app :theme="currentTheme">
    <div class="login-wrapper" :class="{ 'login-dark': isDark }">
      <div class="theme-toggle">
        <v-btn
          icon
          variant="text"
          size="small"
          @click="cycleTheme"
        >
          <v-icon :color="themeIconColor" size="small">{{ themeIcon }}</v-icon>
        </v-btn>
      </div>
      <div class="login-card-container">
        <div class="logo-section">
          <img
            :src="logo"
            alt="drydock"
            class="logo-bounce"
            :class="{ 'logo-invert': isDark }"
          />
          <h1 class="app-title" :class="{ 'text-white': isDark }">drydock</h1>
          <p class="app-subtitle" :class="{ 'text-grey-lighten-1': isDark, 'text-grey-darken-1': !isDark }">
            Container update monitoring
          </p>
        </div>

        <v-card class="login-card" elevation="1" rounded="lg">
          <v-tabs
            v-if="strategies.length > 1"
            v-model="strategySelected"
            color="secondary"
            grow
          >
            <v-tab
              v-for="strategy in strategies"
              :key="strategy.name"
              class="text-body-2"
            >
              {{ strategy.name }}
            </v-tab>
          </v-tabs>

          <v-window v-model="strategySelected">
            <v-window-item
              v-for="strategy in strategies"
              :key="strategy.type + strategy.name"
            >
              <login-basic
                v-if="strategy.type === 'basic'"
                :dark="isDark"
                @authentication-success="onAuthenticationSuccess"
              />
              <login-oidc
                v-if="strategy.type === 'oidc'"
                :name="strategy.name"
                :dark="isDark"
                @authentication-success="onAuthenticationSuccess"
              />
            </v-window-item>
          </v-window>
        </v-card>

      </div>
    </div>
  </v-app>
</template>

<script lang="ts" src="./LoginView.ts"></script>

<style scoped>
.login-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  padding: 16px;
  transition: background 0.3s ease;
}

.login-dark {
  background: #121212;
}

.login-card-container {
  width: 100%;
  max-width: 400px;
}

.logo-section {
  text-align: center;
  margin-bottom: 32px;
}

.logo-bounce {
  width: 120px;
  height: auto;
  animation: gentle-bounce 3s ease-in-out infinite;
  transition: filter 0.3s ease;
}

.logo-invert {
  filter: invert(1);
}

@keyframes gentle-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.app-title {

  font-size: 2rem;
  font-weight: 700;
  color: #1a1a1a;
  margin-top: 16px;
  letter-spacing: -1px;
  transition: color 0.3s ease;
}

.app-subtitle {

  font-size: 0.8rem;
  font-weight: 400;
  margin-top: 4px;
  letter-spacing: -0.3px;
  transition: color 0.3s ease;
}

.login-card {
  overflow: hidden;
}

.theme-toggle {
  position: absolute;
  top: 16px;
  right: 16px;
}
</style>
