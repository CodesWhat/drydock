<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getOidcRedirection, getStrategies, loginBasic } from '../services/auth';
import { useTheme } from '../theme/useTheme';

const router = useRouter();
const route = useRoute();
const { isDark, themeVariant, toggleVariant, transitionTheme } = useTheme();

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

const hasBasic = ref(false);
const oidcStrategies = ref<Strategy[]>([]);

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
    await loginBasic(username.value, password.value);
    navigateAfterLogin();
  } catch {
    error.value = 'Invalid username or password';
  } finally {
    submitting.value = false;
  }
}

async function handleOidc(name: string) {
  try {
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
  if (lower.includes('github')) return 'fa-brands fa-github';
  if (lower.includes('gitlab')) return 'fa-brands fa-gitlab';
  if (lower.includes('google')) return 'fa-brands fa-google';
  if (lower.includes('microsoft') || lower.includes('azure')) return 'fa-brands fa-microsoft';
  if (lower.includes('okta')) return 'fa-solid fa-key';
  return 'fa-solid fa-right-to-bracket';
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-8 dd-bg">
    <!-- Theme toggle — top-right corner -->
    <button
      class="fixed top-4 right-4 flex items-center justify-center w-9 h-9 dd-rounded transition-colors dd-text-secondary hover:dd-bg-elevated"
      :class="themeVariant === 'light' ? 'hover:dd-text-caution' : themeVariant === 'dark' ? 'hover:dd-text-info' : 'hover:dd-text'"
      @click="transitionTheme(() => toggleVariant(), $event)"
    >
      <template v-if="themeVariant === 'system'"><i class="fa-solid fa-display text-[14px]" /></template>
      <AppIcon v-else :name="themeVariant === 'dark' ? 'moon' : 'sun'" :size="14" />
    </button>

    <!-- Loading state -->
    <div v-if="loading" class="dd-text-secondary">
      <i class="fa-solid fa-spinner fa-spin mr-2" />
      Loading...
    </div>

    <!-- Login card -->
    <div
      v-else
      class="w-full dd-rounded-lg overflow-hidden"
      style="max-width: 420px; background-color: var(--dd-bg-card); border: 1px solid var(--dd-border-strong); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);"
    >
      <div class="p-8">
        <!-- Logo -->
        <div class="flex justify-center mb-5">
          <img :src="whaleLogo" alt="Drydock" class="h-12 w-auto login-logo" :style="isDark ? 'filter: invert(1)' : ''" />
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
              <i class="fa-solid fa-spinner fa-spin mr-2" />
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
        <div v-if="oidcStrategies.length > 0" :class="oidcStrategies.length <= 3 ? `grid grid-cols-${oidcStrategies.length} gap-3` : 'flex flex-col gap-3'">
          <button
            v-for="strategy in oidcStrategies"
            :key="strategy.name"
            type="button"
            class="flex items-center justify-center gap-2 py-2 text-xs font-medium dd-rounded dd-text-secondary transition-colors hover:dd-bg-elevated cursor-pointer"
            style="background-color: var(--dd-bg-inset); border: 1px solid var(--dd-border-strong);"
            @click="handleOidc(strategy.name)"
          >
            <i :class="oidcIcon(strategy.name)" class="text-[13px]" />
            {{ strategy.name }}
          </button>
        </div>

        <!-- No strategies available -->
        <div v-if="!hasBasic && oidcStrategies.length === 0" class="text-center dd-text-muted text-sm">
          No authentication methods configured.
        </div>
      </div>
    </div>
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
</style>
