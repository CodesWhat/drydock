import { readonly, ref } from 'vue';
import { acknowledgeApiKeyReview } from '../services/auth';

/**
 * Whether this session still owes an API key review. A recovery-code sign-in
 * sets it server-side; the router guard mirrors it from `/auth/user` on every
 * navigation, and the API Keys view releases it through `acknowledge`.
 */
const pending = ref(false);

function setApiKeyReviewPending(value: boolean) {
  pending.value = value;
}

async function acknowledge() {
  await acknowledgeApiKeyReview();
  pending.value = false;
}

export function useApiKeyReview() {
  return { pending: readonly(pending), setApiKeyReviewPending, acknowledge };
}
