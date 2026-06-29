import { type MaybeRefOrGetter, onScopeDispose, ref, toValue, watch } from 'vue';

/**
 * Returns a reactive `Ref<number>` containing `Date.now()`, updated on each
 * tick of a `setInterval` at `intervalMs` milliseconds (default: 1000ms).
 *
 * The interval is cleared automatically when the enclosing Vue effect scope
 * (component, `effectScope`) is disposed — use inside `setup()` or an
 * `effectScope.run()` block so cleanup happens correctly.
 *
 * @param intervalMs Tick interval in milliseconds. Defaults to 1000 (1 second).
 * @param enabled Reactive source controlling whether the ticker is running.
 *   Accepts a `Ref<boolean>`, a getter `() => boolean`, or a plain boolean.
 *   Defaults to `true` (always running). When `false` no interval is started;
 *   toggling the value starts/stops the interval without restarting from zero.
 */
export function useNow(intervalMs = 1000, enabled: MaybeRefOrGetter<boolean> = true) {
  const now = ref(Date.now());
  let timerId: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (timerId !== undefined) {
      clearInterval(timerId);
      timerId = undefined;
    }
  };

  const start = () => {
    // c8 ignore next -- defensive guard; watch fires only on boolean change so start() cannot be called while already running
    if (timerId !== undefined) return;
    now.value = Date.now();
    timerId = setInterval(() => {
      now.value = Date.now();
    }, intervalMs);
  };

  watch(
    () => toValue(enabled),
    (on) => {
      if (on) start();
      else stop();
    },
    { immediate: true, flush: 'sync' },
  );

  onScopeDispose(stop);
  return now;
}
