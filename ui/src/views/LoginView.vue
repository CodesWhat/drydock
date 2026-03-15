<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ROUTES } from '../router/routes';
import whaleLogo from '../assets/whale-logo.png?inline';
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

interface AuthProviderError {
  provider: string;
  error: string;
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
const connectionLost = ref(false);
const authErrors = ref<AuthProviderError[]>([]);

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 30_000;

let retryDelayMs = INITIAL_RETRY_DELAY_MS;
let connectivityTimer: ReturnType<typeof setTimeout> | undefined;
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
    await loadStrategies();
  } catch {
    error.value = 'Failed to load authentication methods';
    connectionLost.value = true;
    scheduleConnectivityRetry();
  } finally {
    loading.value = false;
  }
});

function navigateAfterLogin() {
  const next = route.query.next;
  if (next && typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
    router.push(next);
  } else {
    router.push(ROUTES.DASHBOARD);
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
    const redirect =
      result && typeof result === 'object'
        ? ((result as { redirect?: unknown; url?: unknown }).redirect ??
          (result as { redirect?: unknown; url?: unknown }).url)
        : undefined;

    if (typeof redirect === 'string') {
      const parsedUrl = new URL(redirect, globalThis.location.origin);
      const isHttp = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
      if (isHttp) {
        globalThis.location.assign(parsedUrl.toString());
        return;
      }
    }
    error.value = `Failed to connect to ${name}`;
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

async function loadStrategies() {
  const response = await getStrategies();
  const data = response.providers as Strategy[];
  strategies.value = data;
  hasBasic.value = data.some((s: Strategy) => s.type === 'basic');
  oidcStrategies.value = data.filter((s: Strategy) => s.type === 'oidc');
  authErrors.value = response.errors ?? [];
  error.value = '';
  connectionLost.value = false;
  retryDelayMs = INITIAL_RETRY_DELAY_MS;
  clearConnectivityRetry();

  // If anonymous strategy exists, skip login entirely
  if (data.some((s: Strategy) => s.type === 'anonymous')) {
    navigateAfterLogin();
    return;
  }

  // If only one OIDC provider with auto-redirect, go straight there
  if (!hasBasic.value && oidcStrategies.value.length === 1 && oidcStrategies.value[0].redirect) {
    await handleOidc(oidcStrategies.value[0].name);
  }
}

function formatAuthProviderError(authProviderError: AuthProviderError): string {
  const [rawType, ...nameParts] = authProviderError.provider.split(':');
  const providerType = rawType?.toLowerCase() ?? '';
  const providerName = nameParts.join(':').trim();

  if (providerType === 'basic') {
    return `Basic auth '${providerName || 'default'}': ${authProviderError.error}`;
  }
  if (providerType === 'oidc') {
    return `OIDC provider '${providerName || 'default'}': ${authProviderError.error}`;
  }
  if (providerName.length > 0) {
    return `${providerType} '${providerName}': ${authProviderError.error}`;
  }
  return `${authProviderError.provider}: ${authProviderError.error}`;
}

async function checkConnectivity() {
  try {
    await loadStrategies();
  } catch {
    connectionLost.value = true;
    scheduleConnectivityRetry();
  }
}

function scheduleConnectivityRetry() {
  clearConnectivityRetry();
  connectivityTimer = setTimeout(checkConnectivity, retryDelayMs);
  retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
}

function clearConnectivityRetry() {
  if (connectivityTimer) {
    clearTimeout(connectivityTimer);
    connectivityTimer = undefined;
  }
}

onUnmounted(() => {
  clearConnectivityRetry();
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-8 dd-bg">
    <!-- Login card — starts invisible, fades in once strategies are loaded -->
    <Transition name="login-card">
      <div
        v-if="!loading"
        class="w-full dd-rounded-lg overflow-hidden"
        style="max-width: 420px; background-color: var(--dd-bg-card); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);"
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
        <form v-if="hasBasic" @submit.prevent="handleBasicLogin" class="space-y-5">
          <div>
            <label class="block text-[0.6875rem] font-medium uppercase tracking-wider mb-2.5 dd-text-muted">
              Username
            </label>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              required
              class="w-full px-3 py-2.5 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
              style="background-color: var(--dd-bg-inset);"
              placeholder="Enter your username"
            />
          </div>

          <div>
            <label class="block text-[0.6875rem] font-medium uppercase tracking-wider mb-2.5 dd-text-muted">
              Password
            </label>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              class="w-full px-3 py-2.5 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
              style="background-color: var(--dd-bg-inset);"
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
          <span class="text-[0.6875rem] dd-text-muted">or continue with</span>
          <div class="flex-1 h-px" style="background-color: var(--dd-border-strong);" />
        </div>

        <!-- OIDC provider buttons -->
        <div v-if="oidcStrategies.length > 0" :class="oidcLayoutClass">
          <button
            v-for="strategy in oidcStrategies"
            :key="strategy.name"
            type="button"
            class="flex items-center justify-center gap-2 py-2 text-xs font-medium dd-rounded dd-text-secondary transition-colors hover:dd-bg-elevated cursor-pointer"
            style="background-color: var(--dd-bg-inset);"
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
          <span class="text-[0.6875rem] dd-text-muted">Remember me</span>
        </label>

        <!-- No strategies available -->
        <div v-if="!hasBasic && oidcStrategies.length === 0" class="text-center text-sm">
          <div v-if="authErrors.length > 0" class="mt-3 text-left space-y-2">
            <div
              v-for="(authProviderError, index) in authErrors"
              :key="index"
              class="px-3 py-2 text-xs dd-rounded dd-bg-danger-muted dd-text-danger"
            >
              {{ formatAuthProviderError(authProviderError) }}
            </div>
          </div>
          <p v-else class="dd-text-muted">No authentication methods configured.</p>
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
            <div class="disconnect-bounce h-10 mb-1">
              <img :src="whaleLogo" alt="" class="h-10 w-auto"
                   :style="[{ transform: 'rotate(180deg) scaleX(-1)' }, isDark ? { filter: 'invert(1)' } : {}]" />
            </div>
            <h2 class="text-sm font-bold dd-text">Connection Lost</h2>
            <p class="text-[0.6875rem] dd-text-muted leading-relaxed">
              The server is unreachable. Waiting for it to come back online...
            </p>
            <div class="flex items-center gap-2 mt-1">
              <AppIcon name="spinner" :size="12" class="dd-spin dd-text-muted" />
              <span class="text-[0.625rem] dd-text-muted">Reconnecting</span>
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
.disconnect-bounce {
  animation: bounce 2s ease-in-out infinite;
}
</style>
