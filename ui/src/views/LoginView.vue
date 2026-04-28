<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { ROUTES } from '../router/routes';
import whaleLogo from '../assets/whale-logo.png?inline';
import { getOidcRedirection, getStrategies, loginBasic, setRememberMe } from '../services/auth';
import { useTheme } from '../theme/useTheme';
import { errorMessage } from '../utils/error';

const router = useRouter();
const route = useRoute();
const { isDark } = useTheme();
const { t } = useI18n();

interface Strategy {
  type: string;
  name: string;
  redirect?: boolean;
}

interface AuthProviderError {
  provider: string;
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStrategy(value: unknown): value is Strategy {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.type !== 'string' || typeof value.name !== 'string') {
    return false;
  }
  return typeof value.redirect === 'undefined' || typeof value.redirect === 'boolean';
}

function isAuthProviderError(value: unknown): value is AuthProviderError {
  return isRecord(value) && typeof value.provider === 'string' && typeof value.error === 'string';
}

function parseStrategies(value: unknown): Strategy[] {
  return Array.isArray(value) ? value.filter(isStrategy) : [];
}

function parseAuthProviderErrors(value: unknown): AuthProviderError[] {
  return Array.isArray(value) ? value.filter(isAuthProviderError) : [];
}

function extractOidcRedirect(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const redirect = value.redirect ?? value.url;
  return typeof redirect === 'string' ? redirect : undefined;
}

function extractStringArray(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }
  return value[key].filter((item): item is string => typeof item === 'string');
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized.length > 0 ? normalized : '/';
}

function toEndpointKey(url: URL): string {
  return `${url.origin}${normalizePathname(url.pathname)}`;
}

function isAllowedOidcRedirect(value: unknown, redirect: string): boolean {
  const parsedUrl = new URL(redirect, globalThis.location.origin);
  const isHttp = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  if (!isHttp) {
    return false;
  }

  const strictEndpoints = extractStringArray(value, 'strictEndpoints');
  if (strictEndpoints.length > 0) {
    return strictEndpoints.includes(toEndpointKey(parsedUrl));
  }

  const allowedOrigins = extractStringArray(value, 'allowedOrigins');
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(parsedUrl.origin);
  }

  return false;
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
    error.value = t('loginView.errors.loadFailed');
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
  } catch (loginError: unknown) {
    const loginErrorMessage = errorMessage(loginError).trim();
    if (
      loginErrorMessage.length === 0 ||
      loginErrorMessage === 'Username or password error' ||
      loginErrorMessage === 'Unauthorized'
    ) {
      error.value = t('loginView.errors.invalidCredentials');
    } else {
      error.value = loginErrorMessage;
    }
  } finally {
    submitting.value = false;
  }
}

async function handleOidc(name: string) {
  try {
    await setRememberMe(rememberMe.value);
    const result = await getOidcRedirection(name);
    const redirect = extractOidcRedirect(result);

    if (typeof redirect === 'string' && isAllowedOidcRedirect(result, redirect)) {
      const parsedUrl = new URL(redirect, globalThis.location.origin);
      globalThis.location.assign(parsedUrl.toString());
      return;
    }
    error.value = t('loginView.errors.oidcFailed', { name });
  } catch {
    error.value = t('loginView.errors.oidcFailed', { name });
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
  const data = parseStrategies(response.providers);
  strategies.value = data;
  hasBasic.value = data.some((s: Strategy) => s.type === 'basic');
  oidcStrategies.value = data.filter((s: Strategy) => s.type === 'oidc');
  authErrors.value = parseAuthProviderErrors(response.errors);
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
    return t('loginView.errors.providerBasic', {
      name: providerName || 'default',
      error: authProviderError.error,
    });
  }
  if (providerType === 'oidc') {
    return t('loginView.errors.providerOidc', {
      name: providerName || 'default',
      error: authProviderError.error,
    });
  }
  if (providerName.length > 0) {
    return t('loginView.errors.providerNamed', {
      type: providerType,
      name: providerName,
      error: authProviderError.error,
    });
  }
  return t('loginView.errors.providerGeneric', {
    provider: authProviderError.provider,
    error: authProviderError.error,
  });
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
        style="max-width: var(--dd-layout-dialog-max-width); background-color: var(--dd-bg-card); box-shadow: var(--dd-shadow-modal);"
      >
      <div class="p-8">
        <!-- Logo -->
        <div class="flex justify-center mb-5">
          <img :src="whaleLogo" alt="Drydock" class="h-20 w-auto login-logo" :style="isDark ? { filter: 'invert(1)' } : {}" />
        </div>

        <!-- Heading -->
        <h1 class="text-lg font-semibold text-center mb-6 dd-text">
          {{ t('loginView.heading') }}
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
            <label class="block text-2xs-plus font-medium uppercase tracking-wider mb-2.5 dd-text-muted">
              {{ t('loginView.username.label') }}
            </label>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              required
              class="w-full px-3 py-2.5 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
              style="background-color: var(--dd-bg-inset);"
              :placeholder="t('loginView.username.placeholder')"
            />
          </div>

          <div>
            <label class="block text-2xs-plus font-medium uppercase tracking-wider mb-2.5 dd-text-muted">
              {{ t('loginView.password.label') }}
            </label>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              class="w-full px-3 py-2.5 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
              style="background-color: var(--dd-bg-inset);"
              :placeholder="t('loginView.password.placeholder')"
            />
          </div>

          <AppButton size="none" variant="plain" weight="none"
            type="submit"
            :disabled="submitting"
            class="w-full py-2.5 text-sm font-semibold dd-rounded transition-colors cursor-pointer"
            style="background-color: var(--dd-primary); color: #fff;"
          >
            <template v-if="submitting">
              <AppIcon name="spinner" :size="14" class="dd-spin mr-2" />
              {{ t('loginView.submit.signingIn') }}
            </template>
            <template v-else>{{ t('loginView.submit.signIn') }}</template>
          </AppButton>
        </form>

        <!-- OIDC separator (only if both basic and OIDC exist) -->
        <div v-if="hasBasic && oidcStrategies.length > 0" class="flex items-center gap-3 my-6">
          <div class="flex-1 h-px" style="background-color: var(--dd-border-strong);" />
          <span class="text-2xs-plus dd-text-muted">{{ t('loginView.separator') }}</span>
          <div class="flex-1 h-px" style="background-color: var(--dd-border-strong);" />
        </div>

        <!-- OIDC provider buttons -->
        <div v-if="oidcStrategies.length > 0" :class="oidcLayoutClass">
          <AppButton size="none" variant="plain" weight="none"
            v-for="strategy in oidcStrategies"
            :key="strategy.name"
            type="button"
            class="flex items-center justify-center gap-2 py-2 text-xs font-medium dd-rounded dd-text-secondary transition-colors hover:dd-bg-elevated cursor-pointer"
            style="background-color: var(--dd-bg-inset);"
            @click="handleOidc(strategy.name)"
          >
            <AppIcon :name="oidcIcon(strategy.name)" :size="13" />
            {{ strategy.name }}
          </AppButton>
        </div>

        <!-- Remember me (shown for all auth methods) -->
        <label v-if="hasBasic || oidcStrategies.length > 0"
               class="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input
            v-model="rememberMe"
            type="checkbox"
            class="w-3.5 h-3.5 dd-rounded-sm accent-[var(--dd-primary)]"
          />
          <span class="text-2xs-plus dd-text-muted">{{ t('loginView.rememberMe') }}</span>
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
          <p v-else class="dd-text-muted">{{ t('loginView.noMethods') }}</p>
        </div>
      </div>
      </div>
    </Transition>

    <!-- Connection Lost Overlay -->
    <Transition name="fade">
      <div v-if="connectionLost"
           class="fixed inset-0 z-modal bg-black/70 backdrop-blur-sm flex items-center justify-center">
        <div class="w-full max-w-[var(--dd-layout-overlay-max-width)] mx-4 dd-rounded-lg overflow-hidden shadow-2xl text-center"
             :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
          <div class="flex flex-col items-center px-6 py-8 gap-3">
            <div class="disconnect-bounce h-10 mb-1">
              <img :src="whaleLogo" alt="" class="h-10 w-auto"
                   :style="[{ transform: 'rotate(180deg) scaleX(-1)' }, isDark ? { filter: 'invert(1)' } : {}]" />
            </div>
            <h2 class="text-sm font-bold dd-text">{{ t('loginView.connectionLost.title') }}</h2>
            <p class="text-2xs-plus dd-text-muted leading-relaxed">
              {{ t('loginView.connectionLost.body') }}
            </p>
            <div class="flex items-center gap-2 mt-1">
              <AppIcon name="spinner" :size="12" class="dd-spin dd-text-muted" />
              <span class="text-2xs dd-text-muted">{{ t('loginView.connectionLost.reconnecting') }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.login-logo {
  animation: bounce var(--dd-duration-pulse) ease-in-out infinite;
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(var(--dd-motion-bounce-y)); }
}
.login-card-enter-active {
  transition: opacity var(--dd-duration-emphasis) ease, transform var(--dd-duration-emphasis) ease;
}
.login-card-enter-from {
  opacity: 0;
  transform: translateY(var(--dd-motion-card-enter-y));
}
.fade-enter-active, .fade-leave-active {
  transition: opacity var(--dd-duration-enter) ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
.disconnect-bounce {
  animation: bounce var(--dd-duration-pulse) ease-in-out infinite;
}
</style>
