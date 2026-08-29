import { findDockerTriggerForContainer } from '../api/docker-trigger.js';
import type Trigger from '../triggers/providers/Trigger.js';
import { isThresholdReached } from '../triggers/providers/trigger-threshold.js';
import {
  type ActionPolicyBlockedReason,
  type ActionPolicyState,
  type ActionPolicyTrigger,
  selectActionTrigger,
} from './action-policy.js';
import type { Container } from './container.js';
import { isRollbackContainer } from './container.js';
import {
  maturityMinAgeDaysToMilliseconds,
  resolveMaturityClock,
  resolveMaturityMinAgeDays,
} from './maturity-policy.js';

export type UpdateBlockerReason =
  | 'no-update-available'
  | 'rollback-container'
  | 'active-operation'
  | 'security-scan-blocked'
  | 'last-update-rolled-back'
  | 'snoozed'
  | 'skip-tag'
  | 'skip-digest'
  | 'maturity-not-reached'
  | 'threshold-not-reached'
  | 'trigger-excluded'
  | 'trigger-not-included'
  | 'agent-mismatch'
  | 'no-update-trigger-configured'
  | 'self-update-unavailable'
  | 'maintenance-window-closed';

/**
 * Severity controls how a blocker is enforced:
 * - 'hard': API rejects manual update with the blocker's message; UI disables the Update button.
 * - 'soft': API allows manual update; UI shows the pill but the button stays enabled (with a
 *   warning + confirm modal listing the soft blockers).
 *
 * `trigger-not-included` and `trigger-excluded` were 'soft' in v1.5.x-v1.6.x with a
 * deprecation notice; the flip to 'hard' landed in v1.7.0 (spec-6.0.1-action-policy.md
 * slice 6). See DEPRECATIONS.md.
 */
export type UpdateBlockerSeverity = 'hard' | 'soft';

export const BLOCKER_SEVERITY: Record<UpdateBlockerReason, UpdateBlockerSeverity> = {
  'no-update-available': 'hard',
  'rollback-container': 'hard',
  'active-operation': 'hard',
  'security-scan-blocked': 'hard',
  'last-update-rolled-back': 'hard',
  'agent-mismatch': 'hard',
  'no-update-trigger-configured': 'hard',
  'self-update-unavailable': 'hard',
  snoozed: 'soft',
  'skip-tag': 'soft',
  'skip-digest': 'soft',
  'maturity-not-reached': 'soft',
  'threshold-not-reached': 'soft',
  // Hard as of v1.7.0 (spec-6.0.1-action-policy.md slice 6). See DEPRECATIONS.md.
  'trigger-excluded': 'hard',
  'trigger-not-included': 'hard',
  // soft: manual UI/API updates bypass this; only auto-trigger dispatch is gated
  'maintenance-window-closed': 'soft',
};

export interface UpdateBlocker {
  reason: UpdateBlockerReason;
  severity: UpdateBlockerSeverity;
  message: string;
  actionable: boolean;
  actionHint?: string;
  liftableAt?: string;
  details?: Record<string, unknown>;
}

export function getHardBlockers(eligibility: UpdateEligibility | undefined): UpdateBlocker[] {
  if (!eligibility) return [];
  return eligibility.blockers.filter((blocker) => blocker.severity === 'hard');
}

export function getSoftBlockers(eligibility: UpdateEligibility | undefined): UpdateBlocker[] {
  if (!eligibility) return [];
  return eligibility.blockers.filter((blocker) => blocker.severity === 'soft');
}

export function hasHardBlocker(eligibility: UpdateEligibility | undefined): boolean {
  return getHardBlockers(eligibility).length > 0;
}

export function getPrimaryHardBlocker(
  eligibility: UpdateEligibility | undefined,
): UpdateBlocker | undefined {
  return getHardBlockers(eligibility)[0];
}

type UpdateSecurityScan = NonNullable<NonNullable<Container['security']>['updateScan']>;

function updateScanMatchesCandidate(container: Container, updateScan: UpdateSecurityScan): boolean {
  const candidateDigest = container.result?.digest;
  if (candidateDigest) {
    return (
      updateScan.imageDigest === candidateDigest || updateScan.image.endsWith(`@${candidateDigest}`)
    );
  }

  const candidateTag = container.result?.tag;
  return Boolean(
    candidateTag &&
      (updateScan.image === candidateTag || updateScan.image.endsWith(`:${candidateTag}`)),
  );
}

function makeBlocker(
  blocker: Omit<UpdateBlocker, 'severity'>,
  severityOverride?: UpdateBlockerSeverity,
): UpdateBlocker {
  return { ...blocker, severity: severityOverride ?? BLOCKER_SEVERITY[blocker.reason] };
}

/**
 * Additive, non-blocker reflection of the action-policy resolver's verdict
 * for this container (spec-6.0.1-action-policy.md API surface). Distinct
 * from `blockers`: `manual`/`auto` never produce a blocker, and even a
 * `blocked` verdict here duplicates information already carried by the
 * `trigger-excluded`/`trigger-not-included` blocker rather than gating
 * `eligible` on its own. Drives the UI's "Auto" badge. Omitted entirely
 * when no compatible action trigger exists at all — the
 * `no-update-trigger-configured`/`agent-mismatch` blockers own that
 * messaging (see the `no compatible trigger` comment at the call site).
 */
interface UpdateEligibilityActionPolicy {
  state: ActionPolicyState;
  triggerId?: string;
  reason?: ActionPolicyBlockedReason;
}

export interface UpdateEligibility {
  eligible: boolean;
  blockers: UpdateBlocker[];
  evaluatedAt: string;
  actionPolicy?: UpdateEligibilityActionPolicy;
}

export interface UpdateEligibilityContext {
  triggers: Record<string, Trigger> | undefined;
  getActiveOperation: (
    container: Container,
  ) => { id: string; status: 'queued' | 'in-progress'; updatedAt?: string } | undefined;
  now?: number;
  isSelfUpdateAvailable?: boolean;
  /**
   * Optional. When explicitly set to `false` by a caller, a soft `maintenance-window-closed`
   * blocker is recorded in the eligibility result. Defaults to `undefined`.
   * Auto-update window enforcement happens at two layers: (1) the Docker watcher's scheduled
   * scan (watchFromCron / maybeFastResyncAfterUpdate return early when the window is closed),
   * and (2) the auto-trigger's apply gate (runUpdateAvailableSimpleTrigger defers action
   * triggers when the owning watcher's window is closed, via isAutoUpdateDeferredByMaintenanceWindow).
   * This field lets a caller additionally reflect the window state here as a soft blocker in the
   * eligibility model. Manual UI/API update requests leave it undefined and are never gated by it.
   */
  maintenanceWindowOpen?: boolean;
  /**
   * Optional. Called with the container's own agent name when the `agent-mismatch` or
   * `no-update-trigger-configured` branch is about to fire. Returning `true` (e.g. because
   * the agent's client is mid-registration, per `AgentClient.isRegisteringComponents`)
   * downgrades that blocker to `soft` instead of the reason's default `hard` severity, so the
   * transient window between `AgentClient._doHandshake()` deregistering an agent's components
   * and finishing their re-registration doesn't disable manual updates on display surfaces.
   *
   * This only softens *display* eligibility (container list, SSE enrichment). Admission
   * (`app/updates/request-update.ts`) never wires this callback in, so a hard agent-mismatch
   * always blocks the actual update request — an update can never be enqueued through a
   * wrong-agent trigger during the registration window. See issue #605.
   */
  isAgentPendingRegistration?: (agentName: string | undefined) => boolean;
}

/**
 * Returns true when the container image name identifies the Drydock self-container.
 * Matches `'drydock'` exactly or any image that ends with `'/drydock'`.
 */
export function isSelfContainerImage(imageName: string | undefined): boolean {
  if (!imageName) return false;
  return imageName === 'drydock' || imageName.endsWith('/drydock');
}

// Minimal interface for the trigger instance methods we need at runtime
interface TriggerInstanceMethods {
  agent?: string;
  configuration?: { threshold?: string };
  getId?: () => string;
}

function formatSnoozeDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

function hasRawTagOrDigestUpdate(container: Container): boolean {
  if (!container.image || !container.result) {
    return false;
  }

  // Check tag update (with transform applied by container.ts — use raw values here for
  // consistency with hasRawUpdate in container.ts)
  const localTag = container.image.tag?.value;
  const remoteTag = container.result.tag;
  if (localTag !== undefined && remoteTag !== undefined && localTag !== remoteTag) {
    return true;
  }

  // Fallback to image created date (especially for legacy v1 manifests)
  if (container.image.created !== undefined && container.result.created !== undefined) {
    const localCreatedMs = new Date(container.image.created).getTime();
    const remoteCreatedMs = new Date(container.result.created).getTime();
    if (localCreatedMs !== remoteCreatedMs) {
      return true;
    }
  }

  // Check digest update
  if (
    container.image.digest?.watch &&
    container.image.digest.value !== undefined &&
    container.result.digest !== undefined &&
    container.image.digest.value !== container.result.digest
  ) {
    return true;
  }

  return false;
}

export function computeUpdateEligibility(
  container: Container,
  context: UpdateEligibilityContext,
): UpdateEligibility {
  const now = context.now ?? Date.now();
  const evaluatedAt = new Date(now).toISOString();

  // If no raw update exists at all, short-circuit with no-update-available only
  if (!hasRawTagOrDigestUpdate(container)) {
    return {
      eligible: false,
      blockers: [
        makeBlocker({
          reason: 'no-update-available',
          message: 'No newer image detected.',
          actionable: false,
        }),
      ],
      evaluatedAt,
    };
  }

  const blockers: UpdateBlocker[] = [];

  // maintenance-window-closed: fires only when the caller explicitly passes `false`. Manual
  // API/UI callers pass `undefined` so the window never blocks manual ops. The actual auto-apply
  // gate lives in Trigger.isAutoUpdateDeferredByMaintenanceWindow (simple path) and
  // Trigger.runAcceptedUpdateBatch (batch/digest path). Those guard action triggers regardless
  // of how container detection was triggered.
  if (context.maintenanceWindowOpen === false) {
    blockers.push(
      makeBlocker({
        reason: 'maintenance-window-closed',
        message: 'Outside maintenance window — auto update deferred until the window opens.',
        actionable: false,
      }),
    );
  }

  // 0. self-update-unavailable — fires only when the container is the Drydock self-container
  // AND the caller has explicitly determined that self-update cannot run (isSelfUpdateAvailable
  // === false). When the field is undefined we fail-open (do not block).
  if (context.isSelfUpdateAvailable === false && isSelfContainerImage(container.image?.name)) {
    blockers.push(
      makeBlocker({
        reason: 'self-update-unavailable',
        message:
          'Self-update cannot run in this deployment: the Docker socket is not bind-mounted and the watcher is not configured with a TCP Docker host.',
        actionable: true,
        actionHint:
          'Bind-mount /var/run/docker.sock into the Drydock container, or point the watcher at a TCP Docker host.',
      }),
    );
  }

  // 1. security-scan-blocked — fires when either the candidate update scan or the
  // current container's existing scan is blocked. The candidate scan reflects the
  // image we'd pull; the current scan reflects vulnerabilities we're already running.
  // Either is grounds to halt an update until the operator triages.
  const updateScan = container.security?.updateScan;
  const candidatePassedRelative =
    updateScan?.status === 'passed' &&
    updateScan.relativeGate?.decision === 'passed' &&
    updateScanMatchesCandidate(container, updateScan);
  if (
    container.security?.updateScan?.status === 'blocked' ||
    (container.security?.scan?.status === 'blocked' && !candidatePassedRelative)
  ) {
    blockers.push(
      makeBlocker({
        reason: 'security-scan-blocked',
        message: 'Security scan is blocking this update (critical/high vulnerabilities).',
        actionable: true,
        actionHint: 'Lower the scan severity threshold before updating.',
      }),
    );
  }

  // 1b. last-update-rolled-back — fires when the last update attempt for this
  // container was rolled back and the candidate image target is unchanged. This prevents
  // the user from immediately re-triggering the same broken update.
  //
  // The block is scoped to the strongest candidate identity available: digest
  // when present, otherwise tag. A different candidate target (e.g. a newer
  // release) is never blocked. The operator can also opt out via
  // dd.update.rollback-gate=off.
  if (container.updateRollback) {
    const candidateTarget = container.result?.digest ?? container.result?.tag;
    const rollbackGateLabelRaw = container.labels?.['dd.update.rollback-gate'];
    const rollbackGateOff =
      typeof rollbackGateLabelRaw === 'string' &&
      rollbackGateLabelRaw.trim().toLowerCase() === 'off';

    if (
      !rollbackGateOff &&
      candidateTarget !== undefined &&
      candidateTarget === container.updateRollback.targetDigest
    ) {
      blockers.push(
        makeBlocker({
          reason: 'last-update-rolled-back',
          message:
            'Last update attempt rolled back. The same target image is blocked until a newer image is available.',
          actionable: true,
          actionHint:
            'Wait for a newer image to be released, or set dd.update.rollback-gate=off to override.',
          details: {
            targetDigest: container.updateRollback.targetDigest,
            rollbackReason: container.updateRollback.reason,
            lastError: container.updateRollback.lastError,
            recordedAt: container.updateRollback.recordedAt,
          },
        }),
      );
    }
  }

  // 2. snoozed
  const snoozeUntil = container.updatePolicy?.snoozeUntil;
  if (snoozeUntil) {
    const snoozeUntilMs = new Date(snoozeUntil).getTime();
    if (Number.isFinite(snoozeUntilMs) && snoozeUntilMs > now) {
      blockers.push(
        makeBlocker({
          reason: 'snoozed',
          message: `Snoozed until ${formatSnoozeDate(snoozeUntil)}.`,
          actionable: true,
          actionHint: 'Clear snooze from the container menu.',
          liftableAt: snoozeUntil,
        }),
      );
    }
  }

  // 3. skip-tag
  const remoteTag = container.result?.tag;
  const skipTags = container.updatePolicy?.skipTags;
  if (remoteTag && Array.isArray(skipTags) && skipTags.includes(remoteTag)) {
    blockers.push(
      makeBlocker({
        reason: 'skip-tag',
        message: `Tag ${remoteTag} is in the skip list.`,
        actionable: true,
        actionHint: 'Remove the skip entry from the container menu.',
        details: { skippedTag: remoteTag },
      }),
    );
  }

  // 4. skip-digest
  const remoteDigest = container.result?.digest;
  const skipDigests = container.updatePolicy?.skipDigests;
  if (remoteDigest && Array.isArray(skipDigests) && skipDigests.includes(remoteDigest)) {
    blockers.push(
      makeBlocker({
        reason: 'skip-digest',
        message: `Digest ${remoteDigest} is in the skip list.`,
        actionable: true,
        actionHint: 'Remove the skip entry from the container menu.',
        details: { skippedDigest: remoteDigest },
      }),
    );
  }

  // 5. maturity-not-reached
  if (container.updatePolicy?.maturityMode === 'mature') {
    const maturityClock = resolveMaturityClock(container, now);
    const maturityStartMs = maturityClock.startMs;
    const maturityMinAgeDays = resolveMaturityMinAgeDays(container.updatePolicy.maturityMinAgeDays);
    const maturityMinAgeMs = maturityMinAgeDaysToMilliseconds(maturityMinAgeDays);

    if (maturityStartMs === undefined || now - maturityStartMs < maturityMinAgeMs) {
      const policySource =
        container.updatePolicySources?.maturityMinAgeDays ??
        container.updatePolicySources?.maturityMode;
      const remainingMs =
        maturityStartMs !== undefined
          ? Math.max(0, maturityMinAgeMs - (now - maturityStartMs))
          : maturityMinAgeMs;
      const liftableAt =
        maturityStartMs !== undefined
          ? new Date(maturityStartMs + maturityMinAgeMs).toISOString()
          : undefined;

      blockers.push(
        makeBlocker({
          reason: 'maturity-not-reached',
          message: `Maturity policy requires updates to be at least ${maturityMinAgeDays} days old${policySource ? ` (from ${policySource})` : ''}.`,
          actionable: true,
          actionHint: "Change maturity mode to 'all' or wait for the gate to clear.",
          ...(liftableAt ? { liftableAt } : {}),
          details: {
            minAgeDays: maturityMinAgeDays,
            ...(policySource ? { policySource } : {}),
            remainingMs,
            // Additive #display-honesty item 4 rider: the UI previously re-derived
            // "maturity-blocked" and the clock it measured against independently
            // (container-mapper.ts, useContainerPolicy.ts), drifting from this
            // server-side resolution. Both now read the resolved clock here instead.
            ...(maturityClock.source ? { clockSource: maturityClock.source } : {}),
            ...(maturityStartMs !== undefined
              ? { clockStartAt: new Date(maturityStartMs).toISOString() }
              : {}),
          },
        }),
      );
    }
  }

  // Resolve a candidate docker/dockercompose/portainer trigger for trigger-level checks.
  //
  // findDockerTriggerForContainer uses full compatibility checking (including agent matching),
  // so it won't return a trigger when the agent doesn't match. To distinguish
  // "no docker trigger at all" from "trigger exists but agent is wrong", we also do a
  // type-only lookup that ignores agent constraints.
  const DOCKER_TRIGGER_TYPES = new Set(['docker', 'dockercompose', 'portainer']);

  function findDockerTriggerByTypeOnly(
    triggers: Record<string, TriggerInstanceMethods> | undefined,
  ): TriggerInstanceMethods | undefined {
    if (!triggers) return undefined;
    for (const trigger of Object.values(triggers)) {
      const type = (trigger as unknown as { type?: string }).type ?? '';
      if (DOCKER_TRIGGER_TYPES.has(type.toLowerCase())) {
        return trigger;
      }
    }
    return undefined;
  }

  const candidateTrigger = findDockerTriggerForContainer(context.triggers, container) as unknown as
    | TriggerInstanceMethods
    | undefined;

  const typeOnlyTrigger: TriggerInstanceMethods | undefined =
    candidateTrigger ??
    findDockerTriggerByTypeOnly(
      context.triggers as Record<string, TriggerInstanceMethods> | undefined,
    );

  // Non-blocker action-policy reflection (spec-6.0.1-action-policy.md API surface).
  // Stays `undefined` — and therefore omitted from the response — when no compatible
  // action trigger exists at all (no-update-trigger-configured / agent-mismatch below
  // own that messaging); populated in the `else` branch once a compatible trigger is
  // confirmed to exist.
  let actionPolicy: UpdateEligibilityActionPolicy | undefined;

  if (!typeOnlyTrigger) {
    // 11. no-update-trigger-configured — no docker/dockercompose/portainer trigger exists at all.
    // AgentClient._doHandshake() deregisters an agent's components before re-registering,
    // so an agent-owned container can transiently see zero triggers of any kind during that
    // window too. Apply the same #605 downgrade as agent-mismatch below.
    const isPendingRegistration = container.agent
      ? (context.isAgentPendingRegistration?.(container.agent) ?? false)
      : false;
    blockers.push(
      makeBlocker(
        {
          reason: 'no-update-trigger-configured',
          message:
            'No docker, dockercompose, or portainer action trigger is configured for this container.',
          actionable: true,
          actionHint:
            'Configure `DD_ACTION_DOCKER_*`, `DD_ACTION_DOCKERCOMPOSE_*`, or `DD_ACTION_PORTAINER_*`.',
        },
        isPendingRegistration ? 'soft' : undefined,
      ),
    );
  } else if (!candidateTrigger) {
    // A docker trigger exists but it's not compatible with this container's agent.
    // 10. agent-mismatch (detected here because full lookup failed but type-only succeeded)
    const t = typeOnlyTrigger;
    const triggerAgent = t.agent;
    const isPendingRegistration = context.isAgentPendingRegistration?.(container.agent) ?? false;
    blockers.push(
      makeBlocker(
        {
          reason: 'agent-mismatch',
          message: `Update trigger runs on agent '${triggerAgent ?? '<none>'}'; container is on agent '${container.agent ?? '<none>'}'.`,
          actionable: true,
          actionHint: 'Configure an update trigger for the target agent.',
          details: {
            triggerAgent,
            containerAgent: container.agent,
            triggerId: t.getId?.(),
          },
        },
        isPendingRegistration ? 'soft' : undefined,
      ),
    );
  } else {
    const t = candidateTrigger;

    // 6. threshold-not-reached
    const threshold = (t.configuration?.threshold ?? 'all').toLowerCase();
    if (!isThresholdReached(container, threshold)) {
      blockers.push(
        makeBlocker({
          reason: 'threshold-not-reached',
          message: `Trigger threshold is '${threshold}'; detected update is '${container.updateKind?.semverDiff ?? container.updateKind?.kind ?? 'unknown'}'.`,
          actionable: true,
          actionHint: "Lower the trigger threshold (e.g. from 'major' to 'all').",
          details: {
            threshold,
            updateKind: container.updateKind?.kind,
            semverDiff: container.updateKind?.semverDiff,
            triggerId: t.getId?.(),
          },
        }),
      );
    }

    // 7. rollback-container
    if (isRollbackContainer(container)) {
      blockers.push(
        makeBlocker({
          reason: 'rollback-container',
          message: 'This is a rollback container created during a previous update.',
          actionable: false,
        }),
      );
    }

    // 8. trigger-excluded / 9. trigger-not-included
    //
    // Derived from the action-policy resolver's hybrid multi-trigger walk
    // (spec-6.0.1-action-policy.md decision 3) rather than a single trigger's
    // raw include/exclude booleans: an explicit `dd.action.exclude` match
    // anywhere in the ranked walk is an authoritative hard stop
    // (trigger-excluded), while a container is only trigger-not-included
    // when NO compatible candidate resolves to manual/auto access. This can
    // authorize the container via a different, less-specific trigger than
    // `t` above when the walk finds an authorized fallback — a deliberate,
    // spec-called-out improvement over the pre-6.0.1 single-trigger check.
    // `t` (the raw agent-compatible candidate from
    // findDockerTriggerForContainer) still backs threshold-not-reached and
    // rollback-container above, and backs this block's triggerId only in the
    // trigger-not-included fallback case (no candidate to name a winner
    // from); wiring those to the walk's winner too is left to a later slice.
    const selection = selectActionTrigger(
      context.triggers as unknown as Record<string, ActionPolicyTrigger> | undefined,
      container,
      { requireAuto: false },
    );

    if (selection?.reason === 'excluded') {
      const triggerExclude = container.actionTriggerExclude;
      blockers.push(
        makeBlocker({
          reason: 'trigger-excluded',
          message: `Trigger excluded by container label dd.action.exclude='${triggerExclude}'.`,
          actionable: true,
          actionHint:
            'Adjust the `dd.action.include` / `dd.action.exclude` labels on the container.',
          details: {
            triggerExclude,
            triggerId: selection.triggerId,
          },
        }),
      );
      actionPolicy = { state: 'blocked', reason: 'excluded', triggerId: selection.triggerId };
    } else if (!selection) {
      const triggerInclude = container.actionTriggerInclude;
      blockers.push(
        makeBlocker({
          reason: 'trigger-not-included',
          message:
            triggerInclude === undefined
              ? 'Trigger not matched by container label dd.action.include.'
              : `Trigger not matched by container label dd.action.include='${triggerInclude}'.`,
          actionable: true,
          // References dd.action.auto alongside dd.action.include/exclude (locked-button
          // tooltip copy, spec-6.0.1-action-policy.md): under a trigger's AUTO=onauto,
          // dd.action.auto alone also grants manual access (decision 2) — the only
          // include/exclude vocabulary this blocker used to name.
          actionHint:
            'Adjust the `dd.action.include` / `dd.action.exclude` labels on the container ' +
            '(or `dd.action.auto`, for a trigger configured with AUTO=onauto).',
          details: {
            triggerInclude,
            triggerId: t.getId?.(),
          },
        }),
      );
      actionPolicy = { state: 'blocked', reason: 'not-included', triggerId: t.getId?.() };
    } else {
      // manual/auto: no blocker, but still worth reflecting so the UI can show the
      // "Auto" badge (and distinguish it from a manual-only resolution).
      actionPolicy = { state: selection.state, triggerId: selection.triggerId };
    }
  }

  // 12. active-operation
  const activeOp = context.getActiveOperation(container);
  if (activeOp) {
    const isQueued = activeOp.status === 'queued';
    blockers.push(
      makeBlocker({
        reason: 'active-operation',
        message: isQueued ? 'Update already queued.' : 'Update already in progress.',
        actionable: false,
        details: {
          operationId: activeOp.id,
          status: activeOp.status,
        },
      }),
    );
  }

  // eligible = raw update exists AND no policy/trigger blockers
  const eligible = blockers.length === 0;

  return {
    eligible,
    blockers,
    evaluatedAt,
    ...(actionPolicy ? { actionPolicy } : {}),
  };
}
