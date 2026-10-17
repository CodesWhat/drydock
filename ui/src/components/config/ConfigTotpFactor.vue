<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useClipboard } from '../../composables/useClipboard';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { type TotpErrorKind, useTotpFactor } from '../../composables/useTotpFactor';
import { downloadTextFile } from '../../utils/download-text';
import TotpQrCode from '../TotpQrCode.vue';

const { t, locale } = useI18n();
const { copyToClipboard, isCopied } = useClipboard();
const { require: requireConfirm } = useConfirmDialog();

const {
  loadState,
  loadError,
  status,
  unavailable,
  step,
  intent,
  busy,
  error,
  notice,
  password,
  proof,
  proofMode,
  enrollment,
  confirmCode,
  recoveryCodes,
  saved,
  needsProof,
  load,
  begin,
  setProofMode,
  submitReauth,
  confirm,
  cancel,
  cancelPending,
  finish,
  dispose,
} = useTotpFactor();

const TOTP_LENGTH = 6;
const LOW_RECOVERY_CODES = 3;

const passwordInput = ref<HTMLInputElement | null>(null);
const confirmInput = ref<HTMLInputElement | null>(null);
const codesHeading = ref<HTMLElement | null>(null);
const codesError = ref(false);

const errorKeys: Record<TotpErrorKind, string> = {
  network: 'network',
  generic: 'generic',
  'session-ended': 'sessionEnded',
  'reauth-failed': 'reauthFailed',
  locked: 'locked',
  busy: 'busy',
  'invalid-request': 'invalidRequest',
  'code-format': 'codeFormat',
  'code-wrong': 'codeWrong',
  'enrollment-expired': 'enrollmentExpired',
  'enrollment-gone': 'enrollmentGone',
  'state-changed': 'stateChanged',
  'not-active': 'notActive',
};

const unavailableKeys = {
  'not-local': 'notLocal',
  'https-required': 'httpsRequired',
  'no-key-ring': 'noKeyRing',
  'recovery-session': 'recoverySession',
} as const;

const loadErrorKeys = {
  network: 'network',
  'session-ended': 'sessionEnded',
  load: 'load',
} as const;

function formatDate(value: string | undefined): string {
  const when = new Date(value ?? '');
  return Number.isNaN(when.getTime())
    ? (value ?? '')
    : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(when);
}

function formatTime(value: string): string {
  const when = new Date(value);
  return Number.isNaN(when.getTime())
    ? value
    : new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(when);
}

function formatRetryTime(seconds: number): string {
  const [unit, amount] =
    seconds < 60 ? ['second', Math.max(1, seconds)] : ['minute', Math.ceil(seconds / 60)];
  return new Intl.NumberFormat(locale.value, {
    style: 'unit',
    unit: unit as string,
    unitDisplay: 'long',
  }).format(amount as number);
}

const errorText = computed(() => {
  const current = error.value;
  if (!current) {
    return '';
  }
  if (current.kind === 'locked') {
    return current.retryAfterSeconds === undefined
      ? t('totpFactor.errors.lockedLater')
      : t('totpFactor.errors.locked', { time: formatRetryTime(current.retryAfterSeconds) });
  }
  return t(`totpFactor.errors.${errorKeys[current.kind]}`);
});

const isActive = computed(() => status.value?.status === 'active');
const pending = computed(() => status.value?.pendingEnrollment);
const canAct = computed(() => !unavailable.value && step.value === 'idle' && !pending.value);
const recoveryRemaining = computed(() => status.value?.recoveryCodesRemaining ?? 0);

const reauthReady = computed(() => {
  if (password.value === '') {
    return false;
  }
  if (!needsProof.value) {
    return true;
  }
  return proofMode.value === 'recovery'
    ? proof.value.trim() !== ''
    : proof.value.length === TOTP_LENGTH;
});

const heading = computed(() => (intent.value ? `totpFactor.reauth.heading.${intent.value}` : ''));

/** Authenticator apps format codes as "123 456"; keep the digits only. */
function onDigits(event: Event, apply: (digits: string) => void) {
  const field = event.target as HTMLInputElement;
  const digits = field.value.replaceAll(/\D/g, '').slice(0, TOTP_LENGTH);
  apply(digits);
  field.value = digits;
}

function onSubmitReauth() {
  if (intent.value !== 'remove') {
    void submitReauth();
    return;
  }
  requireConfirm({
    header: t('totpFactor.remove.header'),
    message: t('totpFactor.remove.message'),
    acceptLabel: t('totpFactor.remove.accept'),
    rejectLabel: t('totpFactor.actions.cancel'),
    severity: 'danger',
    accept: () => submitReauth(),
  });
}

function copySecret() {
  if (enrollment.value) {
    void copyToClipboard(enrollment.value.secret, 'totp-secret');
  }
}

function copyCodes() {
  void copyToClipboard(recoveryCodes.value.join('\n'), 'totp-codes');
}

function downloadCodes() {
  const body = `${t('totpFactor.codes.fileHeading')}\n\n${recoveryCodes.value.join('\n')}\n`;
  codesError.value = !downloadTextFile(t('totpFactor.codes.filename'), body);
}

watch(step, async (next) => {
  codesError.value = false;
  await nextTick();
  if (next === 'reauth') {
    passwordInput.value?.focus();
  } else if (next === 'scan') {
    confirmInput.value?.focus();
  } else if (next === 'codes') {
    codesHeading.value?.focus();
  }
});

onMounted(() => load());
onUnmounted(dispose);
</script>

<template>
  <div class="dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-card)' }">
    <div class="px-5 py-4">
      <div class="dd-text-heading-section dd-text">{{ t('totpFactor.title') }}</div>
      <div class="dd-text-card-description">{{ t('totpFactor.description') }}</div>
    </div>

    <div class="px-5 pb-5 space-y-4">
      <div v-if="loadState === 'loading'" class="flex items-center gap-2 dd-text-body dd-text-muted py-2">
        <AppIcon name="refresh" :size="12" class="animate-spin" />
        {{ t('totpFactor.loading') }}
      </div>

      <div
        v-else-if="loadState === 'error'"
        class="dd-rounded px-3 py-2 space-y-2"
        :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
        data-testid="totp-load-error"
        role="alert"
      >
        <div class="dd-text-body">{{ t(`totpFactor.errors.${loadErrorKeys[loadError || 'load']}`) }}</div>
        <AppButton variant="outlined" size="xs" data-testid="totp-retry" @click="load()">
          {{ t('totpFactor.retry') }}
        </AppButton>
      </div>

      <template v-else>
        <div
          v-if="unavailable"
          class="dd-text-body px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
          data-testid="totp-unavailable"
        >
          {{ t(`totpFactor.unavailable.${unavailableKeys[unavailable]}`) }}
        </div>

        <div
          v-if="notice"
          class="dd-text-body px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }"
          data-testid="totp-notice"
          role="status"
        >
          {{ t(`totpFactor.notice.${notice}`) }}
        </div>

        <div
          v-if="errorText"
          class="dd-text-body px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
          data-testid="totp-error"
          role="alert"
        >
          {{ errorText }}
        </div>

        <!-- Status -->
        <div v-if="status && step === 'idle'" class="space-y-2" data-testid="totp-status">
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="badge dd-text-badge-xs inline-flex"
              :style="
                isActive
                  ? { backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }
                  : { backgroundColor: 'var(--dd-bg-inset)', color: 'var(--dd-text-muted)' }
              "
            >
              {{ isActive ? t('totpFactor.status.on') : t('totpFactor.status.off') }}
            </span>
            <span v-if="isActive" class="dd-text-body dd-text-muted">
              {{ t('totpFactor.status.onSince', { date: formatDate(status.activatedAt) }) }}
              ·
              {{ t('totpFactor.status.recoveryRemaining', { count: recoveryRemaining }, recoveryRemaining) }}
            </span>
          </div>
          <div
            v-if="isActive && recoveryRemaining < LOW_RECOVERY_CODES"
            class="dd-text-body"
            :style="{ color: 'var(--dd-warning)' }"
            data-testid="totp-recovery-warning"
          >
            {{ recoveryRemaining === 0 ? t('totpFactor.status.recoveryNone') : t('totpFactor.status.recoveryLow') }}
          </div>
          <div v-if="pending" class="space-y-2" data-testid="totp-pending">
            <div class="dd-text-body dd-text-muted">
              {{ t('totpFactor.status.pending', { time: formatTime(pending.expiresAt) }) }}
            </div>
            <AppButton
              variant="outlined"
              size="sm"
              :disabled="busy"
              data-testid="totp-cancel-pending"
              @click="cancelPending"
            >
              {{ t('totpFactor.actions.cancelSetup') }}
            </AppButton>
          </div>
        </div>

        <div v-if="status && canAct" class="flex items-center gap-2 flex-wrap">
          <AppButton
            v-if="!isActive"
            variant="secondary"
            size="sm"
            data-testid="totp-enable"
            @click="begin('enable')"
          >
            {{ t('totpFactor.actions.enable') }}
          </AppButton>
          <template v-else>
            <AppButton variant="secondary" size="sm" data-testid="totp-replace" @click="begin('replace')">
              {{ t('totpFactor.actions.replace') }}
            </AppButton>
            <AppButton variant="secondary" size="sm" data-testid="totp-regenerate" @click="begin('regenerate')">
              {{ t('totpFactor.actions.regenerate') }}
            </AppButton>
            <AppButton variant="text-danger" size="sm" data-testid="totp-remove" @click="begin('remove')">
              {{ t('totpFactor.actions.remove') }}
            </AppButton>
          </template>
        </div>

        <!-- Step: prove it is you -->
        <form
          v-if="step === 'reauth'"
          class="dd-rounded p-4 space-y-3"
          :style="{ border: '1px solid var(--dd-border)' }"
          data-testid="totp-reauth-form"
          @submit.prevent="onSubmitReauth"
        >
          <div class="dd-text-label font-medium dd-text">{{ t(heading) }}</div>
          <p class="dd-text-card-description">
            {{ needsProof ? t('totpFactor.reauth.hintWithCode') : t('totpFactor.reauth.hint') }}
          </p>

          <div class="space-y-1">
            <label for="totp-password" class="dd-text-label dd-text-muted">
              {{ t('totpFactor.reauth.passwordLabel') }}
            </label>
            <input
              id="totp-password"
              ref="passwordInput"
              v-model="password"
              data-testid="totp-password"
              name="current-password"
              type="password"
              autocomplete="current-password"
              required
              class="w-full px-3 py-2 dd-rounded dd-text-value"
              :placeholder="t('totpFactor.reauth.passwordPlaceholder')"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
            />
          </div>

          <div v-if="needsProof" class="space-y-1">
            <label for="totp-proof" class="dd-text-label dd-text-muted">
              {{ proofMode === 'recovery' ? t('totpFactor.reauth.recoveryLabel') : t('totpFactor.reauth.codeLabel') }}
            </label>
            <input
              v-if="proofMode === 'code'"
              id="totp-proof"
              :value="proof"
              data-testid="totp-proof"
              name="totp-code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9 ]*"
              :maxlength="TOTP_LENGTH * 2"
              required
              class="w-full px-3 py-2 dd-rounded dd-text-value tracking-widest"
              :placeholder="t('totpFactor.reauth.codePlaceholder')"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
              @input="onDigits($event, (digits) => (proof = digits))"
            />
            <input
              v-else
              id="totp-proof"
              v-model="proof"
              data-testid="totp-proof"
              name="recovery-code"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              required
              class="w-full px-3 py-2 dd-rounded dd-text-value"
              :placeholder="t('totpFactor.reauth.recoveryPlaceholder')"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
            />
            <AppButton
              variant="plain"
              size="none"
              weight="none"
              type="button"
              class="dd-text-card-description cursor-pointer"
              data-testid="totp-proof-mode"
              @click="setProofMode(proofMode === 'code' ? 'recovery' : 'code')"
            >
              {{ proofMode === 'code' ? t('totpFactor.reauth.useRecovery') : t('totpFactor.reauth.useCode') }}
            </AppButton>
          </div>

          <div class="flex items-center gap-2">
            <AppButton
              :variant="intent === 'remove' ? 'danger' : 'secondary'"
              size="sm"
              type="submit"
              :disabled="busy || !reauthReady"
              data-testid="totp-reauth-submit"
            >
              {{ busy ? t('totpFactor.reauth.submit.busy') : t(`totpFactor.reauth.submit.${intent}`) }}
            </AppButton>
            <AppButton
              variant="plain"
              size="sm"
              type="button"
              :disabled="busy"
              data-testid="totp-reauth-cancel"
              @click="cancel"
            >
              {{ t('totpFactor.actions.cancel') }}
            </AppButton>
          </div>
        </form>

        <!-- Step: scan and confirm -->
        <div
          v-if="step === 'scan' && enrollment"
          class="dd-rounded p-4 space-y-4"
          :style="{ border: '1px solid var(--dd-border)' }"
          data-testid="totp-scan"
        >
          <div class="dd-text-label font-medium dd-text">{{ t('totpFactor.scan.heading') }}</div>
          <p class="dd-text-body dd-text-secondary">{{ t('totpFactor.scan.instructions') }}</p>
          <p v-if="enrollment.replacesFactor" class="dd-text-body" data-testid="totp-replace-note">
            {{ t('totpFactor.scan.replaceNote') }}
          </p>

          <div class="w-48 h-48 max-w-full mx-auto bg-white p-0 dd-rounded overflow-hidden">
            <TotpQrCode :value="enrollment.otpauthUri" :label="t('totpFactor.scan.qrLabel')" />
          </div>

          <div class="space-y-1">
            <div class="dd-text-label dd-text-muted">{{ t('totpFactor.scan.secretLabel') }}</div>
            <div class="flex items-center gap-2 flex-wrap">
              <code class="dd-text-value break-all select-all" data-testid="totp-secret">{{ enrollment.secret }}</code>
              <AppButton variant="outlined" size="xs" data-testid="totp-copy-secret" @click="copySecret">
                {{ isCopied('totp-secret') ? t('totpFactor.scan.copied') : t('totpFactor.scan.copySecret') }}
              </AppButton>
            </div>
          </div>

          <form class="space-y-2" data-testid="totp-confirm-form" @submit.prevent="confirm">
            <label for="totp-confirm-code" class="dd-text-label dd-text-muted">
              {{ t('totpFactor.scan.codeLabel') }}
            </label>
            <p class="dd-text-card-description">{{ t('totpFactor.scan.codeHint') }}</p>
            <input
              id="totp-confirm-code"
              ref="confirmInput"
              :value="confirmCode"
              data-testid="totp-confirm-code"
              name="totp-confirm-code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9 ]*"
              :maxlength="TOTP_LENGTH * 2"
              required
              class="w-full px-3 py-2 dd-rounded dd-text-value tracking-widest"
              :placeholder="t('totpFactor.scan.codePlaceholder')"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
              @input="onDigits($event, (digits) => (confirmCode = digits))"
            />
            <p class="dd-text-card-description">
              {{ t('totpFactor.scan.expiresAt', { time: formatTime(enrollment.expiresAt) }) }}
            </p>
            <div class="flex items-center gap-2">
              <AppButton
                variant="secondary"
                size="sm"
                type="submit"
                :disabled="busy || confirmCode.length !== TOTP_LENGTH"
                data-testid="totp-confirm-submit"
              >
                {{ busy ? t('totpFactor.scan.confirming') : t('totpFactor.scan.confirm') }}
              </AppButton>
              <AppButton
                variant="plain"
                size="sm"
                type="button"
                :disabled="busy"
                data-testid="totp-scan-cancel"
                @click="cancel"
              >
                {{ t('totpFactor.actions.cancelSetup') }}
              </AppButton>
            </div>
          </form>
        </div>

        <!-- Step: show-once recovery codes -->
        <div
          v-if="step === 'codes'"
          class="dd-rounded p-4 space-y-3"
          :style="{ border: '1px solid var(--dd-border)' }"
          data-testid="totp-codes-panel"
        >
          <div
            ref="codesHeading"
            tabindex="-1"
            class="dd-text-label font-medium dd-text outline-none"
            data-testid="totp-codes-heading"
          >
            {{ t('totpFactor.codes.heading') }}
          </div>
          <p class="dd-text-body dd-text-secondary">{{ t('totpFactor.codes.description') }}</p>
          <ul
            class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 dd-text-value font-mono"
            data-testid="totp-codes"
          >
            <li v-for="code in recoveryCodes" :key="code" class="select-all">{{ code }}</li>
          </ul>
          <div class="flex items-center gap-2 flex-wrap">
            <AppButton variant="outlined" size="xs" data-testid="totp-copy-codes" @click="copyCodes">
              {{ isCopied('totp-codes') ? t('totpFactor.codes.copied') : t('totpFactor.codes.copy') }}
            </AppButton>
            <AppButton variant="outlined" size="xs" data-testid="totp-download-codes" @click="downloadCodes">
              {{ t('totpFactor.codes.download') }}
            </AppButton>
          </div>
          <p
            v-if="codesError"
            class="dd-text-body"
            :style="{ color: 'var(--dd-danger)' }"
            data-testid="totp-codes-error"
            role="alert"
          >
            {{ t('totpFactor.codes.downloadFailed') }}
          </p>
          <label class="flex items-center gap-2 dd-text-body">
            <input v-model="saved" type="checkbox" data-testid="totp-saved" />
            <span>{{ t('totpFactor.codes.saved') }}</span>
          </label>
          <AppButton
            variant="secondary"
            size="sm"
            :disabled="!saved || busy"
            data-testid="totp-done"
            @click="finish"
          >
            {{ t('totpFactor.codes.done') }}
          </AppButton>
        </div>
      </template>
    </div>
  </div>
</template>
