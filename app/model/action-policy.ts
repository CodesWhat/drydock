import {
  type ContainerTriggerContext,
  type DockerTriggerCandidate,
  type DockerTriggerSpecificity,
  getDockerTriggerSpecificity,
  isTriggerCompatibleWithContainer,
} from '../api/docker-trigger.js';
import logger from '../log/index.js';
import { matchesTriggerReferenceList } from '../triggers/providers/trigger-reference-matching.js';
import type { Container } from './container.js';

/**
 * Per-action access and automatic-execution policy resolver
 * (spec-6.0.1-action-policy.md). Sibling of `update-eligibility.ts`.
 *
 * Kept a pure leaf module deliberately: it must NOT import `Trigger.ts` as a
 * value. `Trigger.ts` imports `updates/request-update.js`, which imports
 * `model/update-eligibility.js` (see `triggers/trigger-category.ts`'s
 * documented require-cycle constraint) — and `update-eligibility.ts` imports
 * THIS module, so `Trigger.ts` -> `request-update.ts` -> `update-eligibility.ts`
 * -> `action-policy.ts` -> `Trigger.ts` would close the cycle. Every
 * dependency below is either a type-only import or a genuine leaf module
 * (`api/docker-trigger.ts`, `triggers/providers/trigger-reference-matching.ts`,
 * `log/index.ts`) with no path back here.
 */

export type ActionPolicyAutoMode = 'all' | 'oninclude' | 'onauto' | 'none';
export type ActionPolicyState = 'blocked' | 'manual' | 'auto';
export type ActionPolicyBlockedReason = 'excluded' | 'not-included';

export interface ActionPolicyResult {
  state: ActionPolicyState;
  reason?: ActionPolicyBlockedReason;
}

/**
 * Structural trigger shape the resolver needs. Real `Trigger` (`Docker` /
 * `DockerCompose`) instances satisfy this without a cast beyond the same
 * `as unknown as` pattern `update-eligibility.ts` already uses for
 * `TriggerInstanceMethods` — deliberately duck-typed rather than importing
 * `Trigger` as a value, for the require-cycle reason above.
 */
export interface ActionPolicyTrigger extends DockerTriggerCandidate {
  configuration?: DockerTriggerCandidate['configuration'] & {
    auto?: boolean | ActionPolicyAutoMode;
  };
  getId: () => string;
}

export interface SelectActionTriggerOptions {
  /**
   * When true, the walk only accepts a candidate whose resolved state is
   * `'auto'`; a candidate that resolves `'manual'` is treated like a skip
   * (not a hard stop) and the walk continues to the next-ranked candidate.
   * Used by auto-dispatch (a later slice); display and manual-admission
   * callers pass `false`/omit.
   */
  requireAuto?: boolean;
  /**
   * When provided, restricts candidates to triggers whose `type` is in this
   * list. Applied before ranking, so an excluded type can never win even when
   * it would otherwise outrank every included candidate (e.g. a compose
   * file-matched trigger is never selected when the caller scopes to
   * `['docker']`). Omitted/undefined keeps today's behavior: every
   * `CANDIDATE_TRIGGER_TYPES` type is eligible.
   */
  triggerTypes?: string[];
}

export interface SelectActionTriggerResult extends ActionPolicyResult {
  trigger: ActionPolicyTrigger;
  triggerId: string;
}

const CANDIDATE_TRIGGER_TYPES = new Set(['docker', 'dockercompose', 'portainer']);

const SPECIFICITY_RANK: Record<DockerTriggerSpecificity, number> = {
  'compose-file-matched': 0,
  'compose-catch-all': 1,
  'docker-generic': 2,
};

/**
 * Dedup set for the one-time "tied triggers" WARN — keyed by the sorted set
 * of tied trigger ids, so the same ambiguous configuration only logs once
 * per process lifetime no matter how many containers (or eligibility
 * recomputations) hit it.
 */
const tiedSpecificityWarningsSeen = new Set<string>();

/**
 * Normalize a trigger's `auto` configuration value the same way
 * `Trigger.normalizeAutoMode` (private, `triggers/providers/Trigger.ts`)
 * does: legacy `true`/`false` booleans map to `'all'`/`'none'`; a string
 * value is lowercased as-is.
 *
 * Deliberately duplicated rather than imported: unlike the include/exclude/
 * auto-label matching grammar (extracted to
 * `triggers/providers/trigger-reference-matching.ts` for exactly this
 * reason), this is a trivial 3-way value coercion, not "matching machinery"
 * — reimplementing three lines here carries negligible drift risk, and
 * `Trigger.ts` cannot be imported as a value from this module without
 * closing the require cycle described above.
 */
function normalizeAutoMode(auto: boolean | ActionPolicyAutoMode | undefined): ActionPolicyAutoMode {
  if (auto === false) {
    return 'none';
  }
  if (auto === true || auto === undefined) {
    return 'all';
  }
  return auto.toLowerCase() as ActionPolicyAutoMode;
}

/**
 * Resolve a single trigger's per-container action policy.
 *
 * spec-6.0.1-action-policy.md resolver pseudocode:
 *
 *   if exclude matches                     -> blocked (reason: excluded)
 *   autoMode = trigger auto mode           # all|oninclude|onauto|none
 *   if autoMode in {all, none}: included = true          # access open (legacy)
 *   else: included = include matches OR (autoMode==onauto AND auto matches)
 *   if !included                           -> blocked (reason: not-included)
 *   switch autoMode:
 *     none      -> manual                  # structurally cannot auto
 *     all       -> auto                    # legacy meaning frozen
 *     oninclude -> auto                    # legacy conflation frozen
 *     onauto    -> auto if auto-label matches else manual
 *
 * Pure: no I/O, no logging, no global state. The global `updateMode` ceiling
 * ('manual' clamps a resolved 'auto' down to 'manual'; 'notify' is a
 * separate admission-level gate) is intentionally NOT applied here — that
 * composition happens at call sites so this resolver stays reusable
 * unmodified for display, manual admission, and auto-dispatch alike.
 */
export function resolveForTrigger(
  trigger: ActionPolicyTrigger,
  container: Container,
): ActionPolicyResult {
  const triggerId = trigger.getId();
  const autoMode = normalizeAutoMode(trigger.configuration?.auto);

  if (matchesTriggerReferenceList(triggerId, container.actionTriggerExclude, container)) {
    return { state: 'blocked', reason: 'excluded' };
  }

  const accessOpen = autoMode === 'all' || autoMode === 'none';
  const includeMatches =
    !accessOpen &&
    matchesTriggerReferenceList(triggerId, container.actionTriggerInclude, container);
  const autoMatches = matchesTriggerReferenceList(
    triggerId,
    container.actionTriggerAuto,
    container,
  );
  const included = accessOpen || includeMatches || (autoMode === 'onauto' && autoMatches);

  if (!included) {
    return { state: 'blocked', reason: 'not-included' };
  }

  switch (autoMode) {
    case 'none':
      return { state: 'manual' };
    case 'onauto':
      return { state: autoMatches ? 'auto' : 'manual' };
    default:
      // 'all' and 'oninclude' both freeze the legacy "access implies auto" meaning.
      return { state: 'auto' };
  }
}

/**
 * Startup migration-checklist WARN support (spec-6.0.1-action-policy.md
 * decision 1): "Switching oninclude→onauto logs a one-time startup WARN
 * listing containers that have a matching dd.action.include but no matching
 * dd.action.auto (a concrete migration checklist)." There is no persisted
 * record of a trigger's *previous* `auto` value to detect an actual
 * before/after transition, so this is computed proactively for any trigger
 * currently configured with `oninclude`: it names every container this
 * trigger is compatible with that matches `dd.action.include` but has no
 * matching `dd.action.auto` label — i.e. the containers that would silently
 * lose automatic execution if the operator switches this trigger's `AUTO`
 * value from `oninclude` to `onauto` without also adding an auto label.
 *
 * Pure (no I/O/logging) so it's independently testable; the caller
 * (`Trigger.init()`) owns deciding when to call this and how to log it.
 */
export function findOnincludeAutoMigrationGaps(
  trigger: ActionPolicyTrigger,
  containers: Container[],
): Container[] {
  const triggerId = trigger.getId();
  return containers.filter((container) => {
    if (!isTriggerCompatibleWithContainer(trigger, container)) {
      return false;
    }
    const includeMatches = matchesTriggerReferenceList(
      triggerId,
      container.actionTriggerInclude,
      container,
    );
    if (!includeMatches) {
      return false;
    }
    return !matchesTriggerReferenceList(triggerId, container.actionTriggerAuto, container);
  });
}

/**
 * Startup inert-label WARN support (spec-6.0.1-action-policy.md decision 1):
 * "AUTO=none unchanged: never registers auto handlers; a dd.action.auto
 * label under none caps at manual (fail closed) with a WARN." Names every
 * container this trigger is compatible with that carries a `dd.action.auto`
 * label matching this trigger — under `AUTO=none` that label can never grant
 * automatic execution (access is capped at manual), so the label is inert
 * and almost certainly a misconfiguration worth flagging.
 *
 * Pure (no I/O/logging) so it's independently testable; the caller
 * (`Trigger.init()`) owns deciding when to call this and how to log it.
 */
export function findInertAutoLabelContainers(
  trigger: ActionPolicyTrigger,
  containers: Container[],
): Container[] {
  const triggerId = trigger.getId();
  return containers.filter((container) => {
    if (!isTriggerCompatibleWithContainer(trigger, container)) {
      return false;
    }
    return matchesTriggerReferenceList(triggerId, container.actionTriggerAuto, container);
  });
}

interface RankedCandidate {
  id: string;
  trigger: ActionPolicyTrigger;
  specificity: DockerTriggerSpecificity;
}

function getCompatibleCandidates(
  triggers: Record<string, ActionPolicyTrigger> | undefined,
  container: ContainerTriggerContext,
): RankedCandidate[] {
  if (!triggers) {
    return [];
  }
  const candidates: RankedCandidate[] = [];
  for (const [id, trigger] of Object.entries(triggers)) {
    if (!CANDIDATE_TRIGGER_TYPES.has(trigger.type)) {
      continue;
    }
    if (!isTriggerCompatibleWithContainer(trigger, container)) {
      continue;
    }
    candidates.push({ id, trigger, specificity: getDockerTriggerSpecificity(trigger, container) });
  }
  return candidates;
}

function warnAboutTiedCandidates(tied: RankedCandidate[]): void {
  const triggerIds = tied.map((candidate) => candidate.trigger.getId());
  const dedupKey = [...triggerIds].sort().join(',');
  if (tiedSpecificityWarningsSeen.has(dedupKey)) {
    return;
  }
  tiedSpecificityWarningsSeen.add(dedupKey);
  logger.warn(
    `Multiple action triggers are equally specific for a container (${triggerIds.join(', ')}); ` +
      'the one registered first wins. Configure dd.action.include/dd.action.exclude, or a ' +
      'compose file path, to disambiguate.',
  );
}

/**
 * Rank compatible candidates by specificity tier (file-matched dockercompose
 * > catch-all dockercompose > generic docker), stably preserving registry
 * insertion order within a tier. Warns once (per distinct tied-id set) when
 * the top tier has more than one candidate, since insertion order deciding
 * the winner in that case is an ambiguous configuration worth flagging.
 */
function rankCandidates(candidates: RankedCandidate[]): RankedCandidate[] {
  const ranked = [...candidates].sort(
    (a, b) => SPECIFICITY_RANK[a.specificity] - SPECIFICITY_RANK[b.specificity],
  );
  if (ranked.length > 1) {
    const topSpecificity = ranked[0].specificity;
    const tied = ranked.filter((candidate) => candidate.specificity === topSpecificity);
    if (tied.length > 1) {
      warnAboutTiedCandidates(tied);
    }
  }
  return ranked;
}

/**
 * Select the winning action trigger for a container across every compatible
 * docker/dockercompose/portainer trigger (agent + compose-file affinity via
 * `isTriggerCompatibleWithContainer`; command triggers are never candidates
 * — they aren't in `CANDIDATE_TRIGGER_TYPES`, matching
 * `findDockerTriggerForContainer`'s default type scope).
 *
 * Hybrid specificity walk (spec-6.0.1-action-policy.md decision 3): ranked
 * candidates are walked in order; an explicit-exclude verdict is a hard stop
 * (the container is blocked — a more permissive, less-specific trigger
 * cannot override an explicit exclude), a not-included verdict is skipped
 * (the walk continues to the next candidate), and the first manual/auto
 * verdict wins (auto-only when `requireAuto`). Returns `undefined` when no
 * candidate produces a winning verdict — callers distinguish "no compatible
 * trigger at all" from "compatible triggers exist but none authorized this
 * container" using their own compatibility probe (this function does not
 * report which case occurred; see `update-eligibility.ts`'s
 * `no-update-trigger-configured` / `agent-mismatch` / `trigger-not-included`
 * branches).
 */
export function selectActionTrigger(
  triggers: Record<string, ActionPolicyTrigger> | undefined,
  container: Container,
  options: SelectActionTriggerOptions = {},
): SelectActionTriggerResult | undefined {
  const compatible = getCompatibleCandidates(triggers, container);
  const scoped = options.triggerTypes
    ? compatible.filter((candidate) => options.triggerTypes?.includes(candidate.trigger.type))
    : compatible;
  const ranked = rankCandidates(scoped);

  for (const candidate of ranked) {
    const result = resolveForTrigger(candidate.trigger, container);

    if (result.state === 'blocked' && result.reason === 'excluded') {
      // Hard stop: an explicit exclude on a candidate the walk has reached
      // authoritatively blocks the container, even if a less-specific,
      // still-unranked candidate would otherwise have authorized it.
      return { ...result, trigger: candidate.trigger, triggerId: candidate.trigger.getId() };
    }

    if (result.state === 'blocked') {
      // not-included: this candidate declines; keep walking.
      continue;
    }

    if (options.requireAuto && result.state !== 'auto') {
      continue;
    }

    return { ...result, trigger: candidate.trigger, triggerId: candidate.trigger.getId() };
  }

  return undefined;
}
