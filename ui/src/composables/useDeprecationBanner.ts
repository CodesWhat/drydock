import { computed, type Ref, ref } from 'vue';
import { useStorageRef } from './useStorageRef';

export interface DeprecationBanner {
  /** Whether the banner should be visible (detected AND not dismissed). */
  visible: Ref<boolean>;
  /** Set to `true` when the condition that triggers the banner is detected. */
  detected: Ref<boolean>;
  /** Dismiss for the current browser session only. */
  dismissForSession: () => void;
  /** Dismiss permanently (persisted to localStorage). */
  dismissPermanently: () => void;
}

/**
 * Encapsulates the session + permanent dismiss logic for a deprecation banner.
 *
 * @param storageKey  A versioned localStorage key, e.g. `'dd-banner-foo-v1'`.
 */
export function useDeprecationBanner(storageKey: string): DeprecationBanner {
  const detected = ref(false);
  const hiddenForSession = ref(false);
  const hiddenPermanently = useStorageRef<boolean>(
    storageKey,
    false,
    (value): value is boolean => typeof value === 'boolean',
  );

  const visible = computed(
    () => detected.value && !hiddenForSession.value && !hiddenPermanently.value,
  );

  function dismissForSession() {
    hiddenForSession.value = true;
  }

  function dismissPermanently() {
    hiddenPermanently.value = true;
  }

  return { visible, detected, dismissForSession, dismissPermanently };
}
