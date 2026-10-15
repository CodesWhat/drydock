const HOOK_LABEL_PREFIX = 'dd.hook.';

/**
 * True for every lifecycle hook label: the pre/post commands and their
 * abort/timeout modifiers. The provenance check that decides whether a hook
 * runs and the recreate step that decides whether a label is carried onto the
 * new container both use this, so they can't disagree about what a hook label is.
 */
export function isHookLabelKey(key: string): boolean {
  return key.startsWith(HOOK_LABEL_PREFIX);
}
