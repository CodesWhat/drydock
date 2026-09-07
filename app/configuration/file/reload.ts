import { logWarn } from '../../log/warn.js';
import {
  findOrphanedNotificationRuleReferences,
  getNotificationTriggerIdsFromState,
  type OrphanedNotificationRuleReference,
} from '../../notifications/trigger-policy.js';
import {
  type ComponentReconcileResult,
  getState,
  reconcileComponentsWithConfiguration,
} from '../../registry/index.js';
import { getNotificationRules } from '../../store/notification.js';
import { withContainerUpdateLocks } from '../../updates/update-locks.js';
import { getErrorMessage } from '../../util/error.js';
import { applyConfigurationReload } from '../index.js';
import {
  buildCandidateEnvAndDiff,
  type ConfigurationValidationDiff,
  ddEnvKeyToSection,
  emptyDiff,
  RELOADABLE_SECTIONS,
} from './diff.js';
import { type ConfigFileInfo, setConfigFileLayer } from './layer.js';
import { loadConfigFile } from './loader.js';
import type { ConfigValueSource } from './sources.js';
import { type ConfigurationValidationResult, validateConfiguration } from './validate.js';

/**
 * `POST /api/v1/config/reload`'s engine (roadmap 7.1 slice 6,
 * spec-7.1-config-file.md section 4.3): re-read `drydock.yml` from disk,
 * validate the merged result exactly like `/validate` does (slice 5's
 * `buildCandidateEnvAndDiff`/`validateConfiguration`, extracted to
 * `./diff.ts` for exactly this reuse), and — only on success — reconcile
 * registered components by difference against the new desired state
 * (`registry/index.ts`'s `reconcileComponentsWithConfiguration`, slice 6's
 * other half), applying only the keys whose section reloads without a
 * restart.
 *
 * Validate-before-apply, nothing partial: a load failure or any validation
 * error refuses the whole reload — `ddEnvVars`, `configFileSources` and the
 * file layer (`./layer.ts`) are never touched — rather than applying
 * whatever happened to validate. `applyConfigurationReload` only ever
 * receives the keys this function already decided are safe to move.
 *
 * After a successful reload, also checks every DB notification rule's
 * trigger references against the reconciled registry state
 * (`findAndLogOrphanedNotificationRules`) and reports/logs any that no
 * longer resolve — the "one real coupling" section 3 calls out: a rule that
 * renamed or removed trigger orphans is reported, never deleted or rewritten.
 */

export interface ConfigurationReloadResult {
  applied: boolean;
  errors: ConfigurationValidationResult['errors'];
  diff: ConfigurationValidationDiff;
  reconcile?: ComponentReconcileResult;
  /** Notification rule references a removed or renamed trigger left behind
   * (spec-7.1-config-file.md section 4.3) — set iff `applied` is true, since
   * nothing in the registry changed otherwise. Never used to delete or
   * rewrite a rule; reporting it is the whole contract. */
  orphanedRules?: OrphanedNotificationRuleReference[];
}

/**
 * Every currently-registered rule's trigger reference that no longer
 * resolves against the just-reconciled registry state — reused by
 * `runReload` after `reconcileComponentsWithConfiguration()` so the answer
 * reflects the new state, not the one being replaced. Logged once per
 * reference (`logWarn`, the same fs-free logging seam `loader.ts`/`watch.ts`
 * already use at this level) so an operator sees it even if nothing ever
 * reads the reload response.
 */
function findAndLogOrphanedNotificationRules(): OrphanedNotificationRuleReference[] {
  const allowedTriggerIds = getNotificationTriggerIdsFromState(getState().trigger);
  const orphanedRules = findOrphanedNotificationRuleReferences(
    getNotificationRules(),
    allowedTriggerIds,
  );
  for (const orphan of orphanedRules) {
    logWarn(
      `Notification rule "${orphan.ruleId}" references trigger "${orphan.triggerId}", ` +
        'which no longer resolves after this reload; the rule was left unchanged.',
    );
  }
  return orphanedRules;
}

function loadFailureError(message: string): ConfigurationValidationResult['errors'] {
  // Mirrors config-validate.ts's own singleDocumentError: no single YAML
  // path or DD_* key exists for a whole-file failure (the file vanished,
  // isn't valid YAML, fails the same hardening checks bootstrap applies),
  // so DD_CONFIG_FILE — the real env var that names a config file — is the
  // closest DD_* key to "the document itself" that exists.
  return [{ path: 'document', envKey: 'DD_CONFIG_FILE', message }];
}

/**
 * Which of `diff.changed` this reload is actually allowed to move: a
 * reloadable-section key, in either direction (the file now sets it, or no
 * longer does). A restart-required changed key is reported in `diff.restart`
 * but never appears in the returned deltas — `applyConfigurationReload`
 * never sees it, so it can't touch `ddEnvVars`/`configFileSources` for that
 * key either.
 */
function buildApplyDeltas(
  changedKeys: readonly string[],
  candidateEnv: Record<string, string | undefined>,
  candidateSources: Record<string, ConfigValueSource>,
): {
  envDelta: Record<string, string | undefined>;
  sourcesDelta: Record<string, ConfigValueSource | undefined>;
} {
  const envDelta: Record<string, string | undefined> = {};
  const sourcesDelta: Record<string, ConfigValueSource | undefined> = {};
  for (const key of changedKeys) {
    const section = ddEnvKeyToSection(key);
    if (!section || !RELOADABLE_SECTIONS.has(section)) {
      continue;
    }
    envDelta[key] = candidateEnv[key];
    sourcesDelta[key] = candidateSources[key];
  }
  return { envDelta, sourcesDelta };
}

async function runReload(): Promise<ConfigurationReloadResult> {
  const interpolatedKeys = new Set<string>();
  const fileInfo: { current?: ConfigFileInfo } = {};

  let newFileLayer: Record<string, string>;
  try {
    newFileLayer = await loadConfigFile(process.env, { interpolatedKeys, fileInfo });
  } catch (error) {
    return { applied: false, errors: loadFailureError(getErrorMessage(error)), diff: emptyDiff() };
  }

  const { candidateEnv, candidateSources, diff } = buildCandidateEnvAndDiff(
    newFileLayer,
    interpolatedKeys,
  );
  const validationResult = await validateConfiguration(candidateEnv);
  if (validationResult.errors.length > 0) {
    return { applied: false, errors: validationResult.errors, diff };
  }

  const { envDelta, sourcesDelta } = buildApplyDeltas(diff.changed, candidateEnv, candidateSources);
  applyConfigurationReload(envDelta, sourcesDelta);
  // Published only now that validation passed and the delta is applied —
  // GET /api/v1/config's `file` field reflects "when was this file last
  // successfully read", independent of whether every key in it reached
  // ddEnvVars (a restart-required key can change in the file without ever
  // being adopted until a real restart).
  setConfigFileLayer(newFileLayer, interpolatedKeys, fileInfo.current);

  const reconcile = await reconcileComponentsWithConfiguration();
  const orphanedRules = findAndLogOrphanedNotificationRules();

  return { applied: true, errors: [], diff, reconcile, orphanedRules };
}

/**
 * Runs the whole read-validate-apply-reconcile sequence inside an EXCLUSIVE
 * `withContainerUpdateLocks` pass: `keys: []` means no per-container lock is
 * taken (a reload isn't scoped to one container), but `exclusive: true`
 * still routes through the real `updateLifecycleGate` — the same gate a
 * self-update already uses to get exclusivity over regular updates, not a
 * second, parallel mechanism. That's what keeps a reload from interleaving
 * with an in-flight update lifecycle: an update reading a trigger mid-
 * reconcile would otherwise be able to observe it torn down between its own
 * two reads. `skipUpdateLocks: true` documents that this call deliberately
 * takes no per-container locks (the empty `keys` array already guarantees
 * that on its own; the flag is belt-and-suspenders for a reader skimming
 * the call site rather than tracing what an empty array does).
 */
export async function reloadConfiguration(): Promise<ConfigurationReloadResult> {
  return withContainerUpdateLocks([], runReload, { exclusive: true, skipUpdateLocks: true });
}
