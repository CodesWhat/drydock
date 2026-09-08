import type { Container } from '../types/container';
import type { TranslateFn } from './container-update';
import type { DependencyAdjacency } from './dependency-graph-view';
import { findStaleParents } from './dependency-update-guard';
import { getPrimaryHardBlocker, getSoftBlockers } from './update-eligibility';

/**
 * Per-row eligibility state the caller has already resolved (roadmap 6.1.1,
 * selective bulk updates). Mirrors the composite of the existing bouncer
 * gate (`Container.bouncer === 'blocked'`) and `UpdateButtonState` from
 * update-eligibility.ts ('none' | 'ready' | 'soft' | 'hard'), with 'blocked'
 * added for the bouncer case update-eligibility.ts doesn't cover.
 */
export type BulkRowState = 'none' | 'ready' | 'soft' | 'hard' | 'blocked';

export interface BulkUpdatePlanEntry {
  id: string;
  name: string;
  reason?: string;
}

export interface BulkUpdatePlan {
  dispatch: BulkUpdatePlanEntry[];
  /** reason: translated text for one of 'stale' | 'inFlight' | 'noUpdate' (containerComponents.selection.reasons.*). */
  skipped: BulkUpdatePlanEntry[];
  /** reason: the bouncer/hard-blocker message, when the backend supplied one. */
  blocked: BulkUpdatePlanEntry[];
  /** dispatch entries that also carry soft blockers; reason: joined soft-blocker messages. */
  softOverrides: BulkUpdatePlanEntry[];
  /** parents of dispatch entries with a pending update of their own, not themselves selected. */
  staleParents: BulkUpdatePlanEntry[];
  /** distinct agent names among dispatch (informational only). */
  agentCount: number;
  /** distinct stack/group keys among dispatch (informational only). */
  stackCount: number;
}

export interface PlanBulkUpdateInput {
  selectedIds: ReadonlySet<string>;
  /** The visible container list. */
  containers: Container[];
  adjacency: DependencyAdjacency | null;
  rowState: (container: Container) => BulkRowState;
  isRowLocked: (container: Container) => boolean;
  /**
   * Resolves the stack/compose-group key a container belongs to, for
   * stackCount. There is no plain "stack" field on Container, grouping is
   * derived server-side (the groups API) plus user overrides
   * (preferences.containers.manualGroups), the same way
   * ContainersView.vue's groupedContainers computed resolves it. Optional:
   * callers that have not wired grouping simply omit it and stackCount stays 0.
   */
  groupKeyForContainer?: (container: Container) => string | null | undefined;
  t: TranslateFn;
}

function skippedReason(kind: 'stale' | 'inFlight' | 'noUpdate', t: TranslateFn): string {
  return t(`containerComponents.selection.reasons.${kind}`);
}

export function planBulkUpdate(input: PlanBulkUpdateInput): BulkUpdatePlan {
  const { selectedIds, containers, adjacency, rowState, isRowLocked, groupKeyForContainer, t } =
    input;
  const containerById = new Map(containers.map((container) => [container.id, container]));

  const dispatch: BulkUpdatePlanEntry[] = [];
  const dispatchContainers: Container[] = [];
  const skipped: BulkUpdatePlanEntry[] = [];
  const blocked: BulkUpdatePlanEntry[] = [];
  const softOverrides: BulkUpdatePlanEntry[] = [];

  for (const id of selectedIds) {
    const container = containerById.get(id);
    if (!container) {
      skipped.push({ id, name: id, reason: skippedReason('stale', t) });
      continue;
    }
    if (isRowLocked(container)) {
      skipped.push({ id, name: container.name, reason: skippedReason('inFlight', t) });
      continue;
    }
    const state = rowState(container);
    if (state === 'none') {
      skipped.push({ id, name: container.name, reason: skippedReason('noUpdate', t) });
      continue;
    }
    if (state === 'blocked') {
      blocked.push({ id, name: container.name });
      continue;
    }
    if (state === 'hard') {
      const hardBlocker = getPrimaryHardBlocker(container.updateEligibility);
      blocked.push({ id, name: container.name, reason: hardBlocker?.message });
      continue;
    }
    dispatch.push({ id, name: container.name });
    dispatchContainers.push(container);
    if (state === 'soft') {
      const softBlockers = getSoftBlockers(container.updateEligibility);
      softOverrides.push({
        id,
        name: container.name,
        reason: softBlockers.map((blocker) => blocker.message).join('; '),
      });
    }
  }

  const dispatchIds = new Set(dispatch.map((entry) => entry.id));
  const staleParents: BulkUpdatePlanEntry[] = [];
  const seenStaleParentIds = new Set<string>();
  if (adjacency) {
    for (const entry of dispatch) {
      const stale = findStaleParents({
        adjacency,
        containerId: entry.id,
        dispatchIds,
        hasPendingUpdate: (parentId) => {
          const parent = containerById.get(parentId);
          return parent ? Boolean(parent.newTag) : undefined;
        },
      });
      for (const parent of stale) {
        if (seenStaleParentIds.has(parent.id)) {
          continue;
        }
        seenStaleParentIds.add(parent.id);
        staleParents.push({ id: parent.id, name: parent.name });
      }
    }
  }

  const agentNames = new Set<string>();
  const stackKeys = new Set<string>();
  for (const container of dispatchContainers) {
    if (container.agent) {
      agentNames.add(container.agent);
    }
    const stackKey = groupKeyForContainer?.(container);
    if (stackKey) {
      stackKeys.add(stackKey);
    }
  }

  return {
    dispatch,
    skipped,
    blocked,
    softOverrides,
    staleParents,
    agentCount: agentNames.size,
    stackCount: stackKeys.size,
  };
}

/**
 * Folds a plan's staleParents into dispatch (the "update the stale parents
 * too" override) and clears staleParents so a re-render doesn't keep
 * re-offering the same warning.
 */
export function withStaleParents(plan: BulkUpdatePlan): BulkUpdatePlan {
  const existingIds = new Set(plan.dispatch.map((entry) => entry.id));
  const additions = plan.staleParents.filter((entry) => !existingIds.has(entry.id));
  return {
    ...plan,
    dispatch: [...plan.dispatch, ...additions],
    staleParents: [],
  };
}
