import { computed, ref } from 'vue';
import {
  cancelTotpEnrollment,
  confirmTotpEnrollment,
  getTotpFactor,
  removeTotpFactor,
  replaceTotpRecoveryCodes,
  startTotpEnrollment,
  type TotpEnrollment,
  type TotpFactorStatus,
  type TotpReauth,
  TotpRequestError,
} from '../services/totp-factor';

type TotpIntent = 'enable' | 'replace' | 'regenerate' | 'remove';
type TotpStep = 'idle' | 'reauth' | 'scan' | 'codes';
type TotpProofMode = 'code' | 'recovery';
type TotpNotice = 'enabled' | 'replaced' | 'regenerated' | 'removed';
type TotpUnavailable = 'not-local' | 'https-required' | 'no-key-ring' | 'recovery-session';
type TotpLoadError = 'network' | 'session-ended' | 'load';
type TotpErrorKind =
  | 'network'
  | 'generic'
  | 'session-ended'
  | 'reauth-failed'
  | 'locked'
  | 'busy'
  | 'invalid-request'
  | 'code-format'
  | 'code-wrong'
  | 'enrollment-expired'
  | 'enrollment-gone'
  | 'state-changed'
  | 'not-active';

interface TotpError {
  kind: TotpErrorKind;
  retryAfterSeconds?: number;
}

/** What a failure turned into: a message the person can act on, or a reason the feature is out of reach. */
type Failure = { error: TotpError } | { unavailable: TotpUnavailable };

/** Kinds that mean the flow in progress is over and the status needs reading again. */
const ENDS_FLOW = new Set<TotpErrorKind>([
  'enrollment-expired',
  'enrollment-gone',
  'state-changed',
  'not-active',
]);

const SIX_DIGITS = /^\d{6}$/;

function stripWhitespace(value: string): string {
  return value.replaceAll(/\s/g, '');
}

function describeFailure(
  error: unknown,
  overrides: Partial<Record<number, TotpErrorKind>> = {},
): Failure {
  if (!(error instanceof TotpRequestError)) {
    return { error: { kind: error instanceof TypeError ? 'network' : 'generic' } };
  }
  const { status, reason, retryAfterSeconds } = error;
  if (status === 403 && reason === 'https-required') {
    return { unavailable: 'https-required' };
  }
  if (status === 403 && reason === 'recovery-assurance') {
    return { unavailable: 'recovery-session' };
  }
  if (status === 503) {
    return { unavailable: 'no-key-ring' };
  }
  const kinds: Record<number, TotpErrorKind> = {
    400: 'invalid-request',
    401: 'session-ended',
    403: 'reauth-failed',
    404: 'not-active',
    409: 'state-changed',
    423: 'locked',
    429: 'busy',
    ...overrides,
  };
  const kind = kinds[status] ?? 'generic';
  return {
    error: retryAfterSeconds === undefined ? { kind } : { kind, retryAfterSeconds },
  };
}

/**
 * State machine behind the Profile tab's two-factor section.
 *
 * The password, seed, otpauth URI, typed codes and recovery codes live only in
 * the refs below. Nothing here touches web storage, the URL or the console, and
 * nothing is keyed to the event stream or the session, so a reconnect can't
 * clear the show-once recovery codes. `dispose` and every exit path wipe them.
 */
export function useTotpFactor() {
  const loadState = ref<'loading' | 'ready' | 'error'>('loading');
  const loadError = ref<TotpLoadError | ''>('');
  const status = ref<TotpFactorStatus | undefined>();
  const unavailable = ref<TotpUnavailable | undefined>();

  const step = ref<TotpStep>('idle');
  const intent = ref<TotpIntent | undefined>();
  const busy = ref(false);
  const error = ref<TotpError | undefined>();
  const notice = ref<TotpNotice | undefined>();

  const password = ref('');
  const proof = ref('');
  const proofMode = ref<TotpProofMode>('code');
  const enrollment = ref<TotpEnrollment | undefined>();
  const confirmCode = ref('');
  const recoveryCodes = ref<string[]>([]);
  const saved = ref(false);
  /** What to tell the person once they leave the recovery-codes screen. */
  let completedNotice: TotpNotice | undefined;
  let disposed = false;

  const needsProof = computed(() => status.value?.status === 'active');

  function wipeSecrets() {
    password.value = '';
    proof.value = '';
    confirmCode.value = '';
    enrollment.value = undefined;
    recoveryCodes.value = [];
    saved.value = false;
  }

  function resetFlow() {
    wipeSecrets();
    step.value = 'idle';
    intent.value = undefined;
    proofMode.value = 'code';
    completedNotice = undefined;
  }

  async function load(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) {
      loadState.value = 'loading';
    }
    try {
      const next = await getTotpFactor();
      if (disposed) {
        return;
      }
      status.value = next;
      loadError.value = '';
      loadState.value = 'ready';
    } catch (failure: unknown) {
      if (disposed) {
        return;
      }
      if (failure instanceof TotpRequestError && failure.status === 403) {
        status.value = undefined;
        unavailable.value = 'not-local';
        loadError.value = '';
        loadState.value = 'ready';
        return;
      }
      if (failure instanceof TotpRequestError && failure.status === 401) {
        loadError.value = 'session-ended';
      } else {
        loadError.value = failure instanceof TypeError ? 'network' : 'load';
      }
      loadState.value = 'error';
    }
  }

  function begin(next: TotpIntent) {
    resetFlow();
    error.value = undefined;
    notice.value = undefined;
    intent.value = next;
    step.value = 'reauth';
  }

  function setProofMode(mode: TotpProofMode) {
    proofMode.value = mode;
    proof.value = '';
  }

  /** The reauth body, or the reason the typed values can't be sent. */
  function buildReauth(): TotpReauth | TotpError {
    if (password.value === '') {
      return { kind: 'invalid-request' };
    }
    if (!needsProof.value) {
      return { password: password.value };
    }
    if (proofMode.value === 'recovery') {
      const recoveryCode = proof.value.trim();
      return recoveryCode === ''
        ? { kind: 'code-format' }
        : { password: password.value, recoveryCode };
    }
    const code = stripWhitespace(proof.value);
    return SIX_DIGITS.test(code) ? { password: password.value, code } : { kind: 'code-format' };
  }

  /** Put a failure on screen. A flow-ending kind sends the person back to the start. */
  async function applyFailure(failure: Failure): Promise<void> {
    if ('unavailable' in failure) {
      resetFlow();
      error.value = undefined;
      unavailable.value = failure.unavailable;
      return;
    }
    error.value = failure.error;
    if (ENDS_FLOW.has(failure.error.kind)) {
      resetFlow();
      await load({ silent: true });
    }
  }

  async function submitReauth(): Promise<void> {
    const current = intent.value;
    if (busy.value || step.value !== 'reauth' || current === undefined) {
      return;
    }
    const reauth = buildReauth();
    if ('kind' in reauth) {
      error.value = reauth;
      return;
    }
    error.value = undefined;
    busy.value = true;
    // The values are on their way; they are not kept for a retry.
    password.value = '';
    proof.value = '';
    try {
      if (current === 'enable' || current === 'replace') {
        const reveal = await startTotpEnrollment(reauth);
        if (disposed) {
          void cancelTotpEnrollment(reveal.id).catch(() => undefined);
          return;
        }
        enrollment.value = reveal;
        step.value = 'scan';
      } else if (current === 'regenerate') {
        const set = await replaceTotpRecoveryCodes(reauth);
        if (disposed) {
          return;
        }
        recoveryCodes.value = set.recoveryCodes;
        completedNotice = 'regenerated';
        step.value = 'codes';
      } else {
        await removeTotpFactor(reauth);
        if (disposed) {
          return;
        }
        resetFlow();
        notice.value = 'removed';
        await load({ silent: true });
      }
    } catch (failure: unknown) {
      if (!disposed) {
        await applyFailure(describeFailure(failure));
      }
    } finally {
      busy.value = false;
    }
  }

  async function confirm(): Promise<void> {
    const pending = enrollment.value;
    if (busy.value || step.value !== 'scan' || pending === undefined) {
      return;
    }
    // Any string sent here burns one of five guesses, and the fifth deletes the
    // enrollment, so only six digits are ever sent.
    const code = stripWhitespace(confirmCode.value);
    if (!SIX_DIGITS.test(code)) {
      error.value = { kind: 'code-format' };
      return;
    }
    error.value = undefined;
    busy.value = true;
    try {
      const set = await confirmTotpEnrollment(pending.id, code);
      if (disposed) {
        return;
      }
      completedNotice = pending.replacesFactor ? 'replaced' : 'enabled';
      enrollment.value = undefined;
      confirmCode.value = '';
      recoveryCodes.value = set.recoveryCodes;
      saved.value = false;
      step.value = 'codes';
    } catch (failure: unknown) {
      if (disposed) {
        return;
      }
      if (failure instanceof TotpRequestError && failure.status === 422) {
        error.value = { kind: 'code-wrong' };
        confirmCode.value = '';
        return;
      }
      await applyFailure(
        describeFailure(failure, { 404: 'enrollment-gone', 410: 'enrollment-expired' }),
      );
    } finally {
      busy.value = false;
    }
  }

  /** Leave the reauth or scan step. The recovery-codes screen has no way out but `finish`. */
  async function cancel(): Promise<void> {
    if (step.value === 'codes') {
      return;
    }
    const pending = enrollment.value;
    const scanning = step.value === 'scan' && pending !== undefined;
    resetFlow();
    error.value = undefined;
    if (scanning) {
      await cancelTotpEnrollment(pending.id).catch(() => undefined);
      await load({ silent: true });
    }
  }

  /** Cancel an enrollment the status reports as pending, whose seed this page never saw. */
  async function cancelPending(): Promise<void> {
    const pending = status.value?.pendingEnrollment;
    if (busy.value || pending === undefined) {
      return;
    }
    error.value = undefined;
    busy.value = true;
    try {
      await cancelTotpEnrollment(pending.id);
      await load({ silent: true });
    } catch (failure: unknown) {
      await applyFailure(describeFailure(failure));
    } finally {
      busy.value = false;
    }
  }

  /** Leave the recovery-codes screen. Only after the person says they saved the codes. */
  async function finish(): Promise<void> {
    if (step.value !== 'codes' || !saved.value) {
      return;
    }
    const done = completedNotice;
    resetFlow();
    notice.value = done;
    await load({ silent: true });
  }

  /** Unmount: wipe everything, and don't leave a pending enrollment whose seed is now lost. */
  function dispose() {
    disposed = true;
    const pending = step.value === 'scan' ? enrollment.value : undefined;
    resetFlow();
    if (pending !== undefined) {
      void cancelTotpEnrollment(pending.id).catch(() => undefined);
    }
  }

  return {
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
  };
}

export type {
  TotpError,
  TotpErrorKind,
  TotpIntent,
  TotpLoadError,
  TotpNotice,
  TotpProofMode,
  TotpStep,
  TotpUnavailable,
};
