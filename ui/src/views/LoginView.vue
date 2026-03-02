<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import whaleLogo from '../assets/whale-logo.png';
import { getOidcRedirection, getStrategies, loginBasic, setRememberMe } from '../services/auth';
import { useTheme } from '../theme/useTheme';

const router = useRouter();
const route = useRoute();
const { isDark } = useTheme();

interface Strategy {
  type: string;
  name: string;
  redirect?: boolean;
}

const strategies = ref<Strategy[]>([]);
const loading = ref(true);
const error = ref('');
const username = ref('');
const password = ref('');
const submitting = ref(false);
const rememberMe = ref(false);

const hasBasic = ref(false);
const oidcStrategies = ref<Strategy[]>([]);
const oidcLayoutClass = computed(() => {
  const count = oidcStrategies.value.length;
  if (count <= 1) {
    return 'grid grid-cols-1 gap-3';
  }
  if (count === 2) {
    return 'grid grid-cols-2 gap-3';
  }
  if (count === 3) {
    return 'grid grid-cols-3 gap-3';
  }
  return 'flex flex-col gap-3';
});

onMounted(async () => {
  try {
    const data = await getStrategies();
    strategies.value = data;
    hasBasic.value = data.some((s: Strategy) => s.type === 'basic');
    oidcStrategies.value = data.filter((s: Strategy) => s.type === 'oidc');

    // If anonymous strategy exists, skip login entirely
    if (data.some((s: Strategy) => s.type === 'anonymous')) {
      navigateAfterLogin();
      return;
    }

    // If only one OIDC provider with auto-redirect, go straight there
    if (!hasBasic.value && oidcStrategies.value.length === 1 && oidcStrategies.value[0].redirect) {
      await handleOidc(oidcStrategies.value[0].name);
      return;
    }
  } catch {
    error.value = 'Failed to load authentication methods';
  } finally {
    loading.value = false;
  }

  startConnectivityPolling();
});

function navigateAfterLogin() {
  const next = route.query.next;
  if (next && typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
    router.push(next);
  } else {
    router.push('/');
  }
}

async function handleBasicLogin() {
  error.value = '';
  submitting.value = true;
  try {
    await loginBasic(username.value, password.value, rememberMe.value);
    navigateAfterLogin();
  } catch {
    error.value = 'Invalid username or password';
  } finally {
    submitting.value = false;
  }
}

async function handleOidc(name: string) {
  try {
    await setRememberMe(rememberMe.value);
    const result = await getOidcRedirection(name);
    if (result?.redirect) {
      window.location.href = result.redirect;
    }
  } catch {
    error.value = `Failed to connect to ${name}`;
  }
}

function oidcIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('github')) return 'github';
  if (lower.includes('gitlab')) return 'gitlab';
  if (lower.includes('google')) return 'google';
  if (lower.includes('microsoft') || lower.includes('azure')) return 'microsoft';
  if (lower.includes('okta')) return 'key';
  return 'sign-in';
}

// Server connectivity monitor
const connectionLost = ref(false);
let connectivityTimer: ReturnType<typeof setInterval> | undefined;

async function checkConnectivity() {
  try {
    const res = await fetch('/auth/strategies', { redirect: 'manual' });
    if (connectionLost.value && res.ok) {
      connectionLost.value = false;
      // Reload strategies now that the server is back
      try {
        const data = await getStrategies();
        strategies.value = data;
        hasBasic.value = data.some((s: Strategy) => s.type === 'basic');
        oidcStrategies.value = data.filter((s: Strategy) => s.type === 'oidc');
        error.value = '';
      } catch {
        // Strategies will be retried on next poll
      }
    }
  } catch {
    connectionLost.value = true;
  }
}

function startConnectivityPolling() {
  if (connectivityTimer) clearInterval(connectivityTimer);
  connectivityTimer = setInterval(checkConnectivity, 10_000);
}

onUnmounted(() => {
  if (connectivityTimer) clearInterval(connectivityTimer);
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-8 dd-bg">
    <!-- Login card — starts invisible, fades in once strategies are loaded -->
    <Transition name="login-card">
      <div
        v-if="!loading"
        class="w-full dd-rounded-lg overflow-hidden"
        style="max-width: 420px; background-color: var(--dd-bg-card); border: 1px solid var(--dd-border-strong); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);"
      >
      <div class="p-8">
        <!-- Logo -->
        <div class="flex justify-center mb-5">
          <img :src="whaleLogo" alt="Drydock" class="h-20 w-auto login-logo" :style="isDark ? { filter: 'invert(1)' } : {}" />
        </div>

        <!-- Heading -->
        <h1 class="text-lg font-semibold text-center mb-6 dd-text">
          Sign in to Drydock
        </h1>

        <!-- Error message -->
        <div
          v-if="error"
          class="mb-4 px-3 py-2 text-xs dd-rounded dd-bg-danger-muted dd-text-danger"
        >
          {{ error }}
        </div>

        <!-- Basic auth form -->
        <form v-if="hasBasic" @submit.prevent="handleBasicLogin" class="space-y-4">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1.5 dd-text-muted">
              Username
            </label>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              required
              class="w-full px-3 py-2 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
              style="background-color: var(--dd-bg-inset); border: 1px solid var(--dd-border-strong);"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider mb-1.5 dd-text-muted">
              Password
            </label>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              class="w-full px-3 py-2 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
              style="background-color: var(--dd-bg-inset); border: 1px solid var(--dd-border-strong);"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            :disabled="submitting"
            class="w-full py-2.5 text-sm font-semibold dd-rounded transition-colors cursor-pointer"
            style="background-color: var(--dd-primary); color: #fff;"
          >
            <template v-if="submitting">
              <AppIcon name="spinner" :size="14" class="dd-spin mr-2" />
              Signing in...
            </template>
            <template v-else>Sign in</template>
          </button>
        </form>

        <!-- OIDC separator (only if both basic and OIDC exist) -->
        <div v-if="hasBasic && oidcStrategies.length > 0" class="flex items-center gap-3 my-6">
          <div class="flex-1 h-px" style="background-color: var(--dd-border-strong);" />
          <span class="text-[11px] dd-text-muted">or continue with</span>
          <div class="flex-1 h-px" style="background-color: var(--dd-border-strong);" />
        </div>

        <!-- OIDC provider buttons -->
        <div v-if="oidcStrategies.length > 0" :class="oidcLayoutClass">
          <button
            v-for="strategy in oidcStrategies"
            :key="strategy.name"
            type="button"
            class="flex items-center justify-center gap-2 py-2 text-xs font-medium dd-rounded dd-text-secondary transition-colors hover:dd-bg-elevated cursor-pointer"
            style="background-color: var(--dd-bg-inset); border: 1px solid var(--dd-border-strong);"
            @click="handleOidc(strategy.name)"
          >
            <AppIcon :name="oidcIcon(strategy.name)" :size="13" />
            {{ strategy.name }}
          </button>
        </div>

        <!-- Remember me (shown for any auth method) -->
        <label v-if="hasBasic || oidcStrategies.length > 0"
               class="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input
            v-model="rememberMe"
            type="checkbox"
            class="w-3.5 h-3.5 dd-rounded-sm accent-[var(--dd-primary)]"
          />
          <span class="text-[11px] dd-text-muted">Remember me</span>
        </label>

        <!-- No strategies available -->
        <div v-if="!hasBasic && oidcStrategies.length === 0" class="text-center dd-text-muted text-sm">
          No authentication methods configured.
        </div>
      </div>
      </div>
    </Transition>

    <!-- Connection Lost Overlay -->
    <Transition name="fade">
      <div v-if="connectionLost"
           class="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center">
        <div class="w-full max-w-[320px] mx-4 dd-rounded-lg overflow-hidden shadow-2xl text-center"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex flex-col items-center px-6 py-8 gap-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center mb-1"
                 :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
              <AppIcon name="warning" :size="18" :style="{ color: 'var(--dd-danger)' }" />
            </div>
            <h2 class="text-sm font-bold dd-text">Connection Lost</h2>
            <p class="text-[11px] dd-text-muted leading-relaxed">
              The server is unreachable. Waiting for it to come back online...
            </p>
            <div class="flex items-center gap-2 mt-1">
              <AppIcon name="spinner" :size="12" class="dd-spin dd-text-muted" />
              <span class="text-[10px] dd-text-muted">Reconnecting</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.login-logo {
  animation: bounce 2s ease-in-out infinite;
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.login-card-enter-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.login-card-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
