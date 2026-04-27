import type {
  UpdateBlocker,
  UpdateBlockerReason,
  UpdateBlockerSeverity,
  UpdateEligibility,
} from '../types/container';

/**
 * Mirror of the backend's BLOCKER_SEVERITY map (see app/model/update-eligibility.ts).
 *
 * Used as a fallback when the API payload predates the severity field. The backend is
 * canonical — keep these in sync.
 */
export const BLOCKER_SEVERITY: Record<UpdateBlockerReason, UpdateBlockerSeverity> = {
  'no-update-available': 'hard',
  'rollback-container': 'hard',
  'active-operation': 'hard',
  'security-scan-blocked': 'hard',
  'agent-mismatch': 'hard',
  'no-update-trigger-configured': 'hard',
  snoozed: 'soft',
  'skip-tag': 'soft',
  'skip-digest': 'soft',
  'maturity-not-reached': 'soft',
  'threshold-not-reached': 'soft',
  // Deprecation: become 'hard' in v1.7.0. See DEPRECATIONS.md.
  'trigger-excluded': 'soft',
  'trigger-not-included': 'soft',
};

export function severityOf(blocker: UpdateBlocker): UpdateBlockerSeverity {
  return blocker.severity ?? BLOCKER_SEVERITY[blocker.reason] ?? 'hard';
}

export function getHardBlockers(eligibility: UpdateEligibility | undefined): UpdateBlocker[] {
  if (!eligibility) return [];
  return eligibility.blockers.filter((blocker) => severityOf(blocker) === 'hard');
}

export function getSoftBlockers(eligibility: UpdateEligibility | undefined): UpdateBlocker[] {
  if (!eligibility) return [];
  return eligibility.blockers.filter((blocker) => severityOf(blocker) === 'soft');
}

export function hasHardBlocker(eligibility: UpdateEligibility | undefined): boolean {
  return getHardBlockers(eligibility).length > 0;
}

export function hasSoftBlocker(eligibility: UpdateEligibility | undefined): boolean {
  return getSoftBlockers(eligibility).length > 0;
}

export function getPrimaryHardBlocker(
  eligibility: UpdateEligibility | undefined,
): UpdateBlocker | undefined {
  return getHardBlockers(eligibility)[0];
}

export function getPrimarySoftBlocker(
  eligibility: UpdateEligibility | undefined,
): UpdateBlocker | undefined {
  return getSoftBlockers(eligibility)[0];
}
