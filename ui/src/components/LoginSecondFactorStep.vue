<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  methods: string[];
  expiresAt: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [proof: { code: string } | { recoveryCode: string }];
  cancel: [];
}>();

const { t, locale } = useI18n();

const TOTP_LENGTH = 6;

const mode = ref<'code' | 'recovery'>('code');
const value = ref('');
const input = ref<HTMLInputElement | null>(null);

const canUseRecovery = computed(() => props.methods.includes('recovery'));
const isRecovery = computed(() => mode.value === 'recovery');
const canSubmit = computed(() =>
  isRecovery.value ? value.value.trim().length > 0 : value.value.length === TOTP_LENGTH,
);

const expiryTime = computed(() => {
  const when = new Date(props.expiresAt);
  if (Number.isNaN(when.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(when);
});

function focusInput() {
  input.value?.focus();
}

function onCodeInput(event: Event) {
  const field = event.target as HTMLInputElement;
  // Authenticator apps format codes as "123 456"; keep digits only.
  const digits = field.value.replaceAll(/\D/g, '').slice(0, TOTP_LENGTH);
  value.value = digits;
  field.value = digits;
}

async function toggleMode() {
  mode.value = isRecovery.value ? 'code' : 'recovery';
  value.value = '';
  await nextTick();
  focusInput();
}

function submit() {
  if (props.submitting || !canSubmit.value) {
    return;
  }
  emit('submit', isRecovery.value ? { recoveryCode: value.value.trim() } : { code: value.value });
}

onMounted(focusInput);
defineExpose({ focus: focusInput });
</script>

<template>
  <form class="space-y-5" @submit.prevent="submit">
    <h2 class="text-sm font-semibold text-center dd-text">{{ t('loginView.challenge.heading') }}</h2>
    <p class="text-xs dd-text-secondary">
      {{ isRecovery ? t('loginView.challenge.recoveryHint') : t('loginView.challenge.codeHint') }}
    </p>

    <div>
      <label
        :for="isRecovery ? 'recovery-code' : 'totp-code'"
        class="block text-2xs-plus font-medium uppercase tracking-wider mb-2.5 dd-text-muted"
      >
        {{ isRecovery ? t('loginView.challenge.recoveryLabel') : t('loginView.challenge.codeLabel') }}
      </label>
      <input
        v-if="!isRecovery"
        id="totp-code"
        ref="input"
        :value="value"
        name="totp-code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        :maxlength="TOTP_LENGTH * 2"
        pattern="[0-9 ]*"
        required
        class="w-full px-3 py-2.5 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors tracking-widest"
        style="background-color: var(--dd-bg-inset);"
        :placeholder="t('loginView.challenge.codePlaceholder')"
        @input="onCodeInput"
      />
      <input
        v-else
        id="recovery-code"
        ref="input"
        v-model="value"
        name="recovery-code"
        type="text"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        required
        class="w-full px-3 py-2.5 text-sm dd-rounded dd-text dd-placeholder outline-none transition-colors"
        style="background-color: var(--dd-bg-inset);"
        :placeholder="t('loginView.challenge.recoveryPlaceholder')"
      />
    </div>

    <p v-if="expiryTime" class="text-2xs-plus dd-text-muted">
      {{ t('loginView.challenge.expiresAt', { time: expiryTime }) }}
    </p>

    <AppButton size="none" variant="plain" weight="none"
      type="submit"
      :disabled="submitting || !canSubmit"
      class="w-full py-2.5 text-sm font-semibold dd-rounded transition-colors cursor-pointer"
      style="background-color: var(--dd-primary); color: var(--dd-primary-fg);"
    >
      <template v-if="submitting">
        <AppIcon name="spinner" :size="14" class="dd-spin mr-2" />
        {{ t('loginView.challenge.verifying') }}
      </template>
      <template v-else>{{ t('loginView.challenge.verify') }}</template>
    </AppButton>

    <div class="flex flex-col items-center gap-2">
      <AppButton v-if="canUseRecovery" size="none" variant="plain" weight="none"
        type="button"
        data-testid="login-challenge-recovery"
        class="text-2xs-plus dd-text-secondary cursor-pointer"
        @click="toggleMode"
      >
        {{ isRecovery ? t('loginView.challenge.useCode') : t('loginView.challenge.useRecovery') }}
      </AppButton>
      <AppButton size="none" variant="plain" weight="none"
        type="button"
        data-testid="login-challenge-cancel"
        class="text-2xs-plus dd-text-muted cursor-pointer"
        @click="emit('cancel')"
      >
        {{ t('loginView.challenge.cancel') }}
      </AppButton>
    </div>
  </form>
</template>
