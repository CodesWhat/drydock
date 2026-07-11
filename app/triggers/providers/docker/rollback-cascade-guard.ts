import { getCanonicalContainerName } from '../../../model/container.js';

/**
 * Build the terminal error for a container name that already carries drydock's
 * own "-old-<epoch-ms>" rollback rename suffix — meaning a previous update (or
 * self-update) attempt failed mid-recreate and was never restored (see
 * created-container-candidate.ts / the macvlan incident). Recreating — or, for
 * self-update, renaming again — from this name would nest another rollback
 * rename on top of the first, compounding the mess and burying the true
 * canonical name deeper with every retry.
 *
 * Shared by ContainerUpdateExecutor's cascade guard (regular updates) and
 * SelfUpdateTransitionShared's guard (self-updates) so the wording — and the
 * multi-level canonical-name strip — never drifts between the two call sites.
 */
export function buildRollbackCascadeGuardError(name: string): Error {
  const canonicalName = getCanonicalContainerName(name);
  return new Error(
    `Container ${name} is already renamed from a previous failed update and was never restored. ` +
      `Refusing to recreate from this name to avoid nesting another rollback rename — manually remove ` +
      `any orphaned "Created" container squatting ${canonicalName} and rename ${name} back to ` +
      `${canonicalName} (or recreate it from your compose file) before retrying. If you intentionally ` +
      `named this container "${name}", note that the "-old-<10+ digit epoch ms>" suffix conflicts with ` +
      `drydock's own rollback naming convention — rename it to something else to make it updatable.`,
  );
}
