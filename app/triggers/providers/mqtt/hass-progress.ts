import type { ContainerUpdateOperationPhase } from '../../../model/container-update-operation.js';

/**
 * The state-payload key carrying the Home Assistant `update` entity object.
 *
 * HA's MQTT update platform renders the entity's `value_template` against the raw
 * state payload and then parses *the rendered result* as JSON
 * (`homeassistant/components/mqtt/update.py`, `_handle_state_message_received`).
 * `in_progress` and `update_percentage` are only read when that rendered result is a
 * JSON object, and the object is validated against a closed whitelist —
 * `installed_version`, `latest_version`, `title`, `release_summary`, `release_url`,
 * `entity_picture`, `in_progress`, `update_percentage` — where any extra key makes HA
 * drop the whole message with a schema warning. Drydock's state payload is the
 * flattened container, which is neither an object of that shape nor free of extra
 * keys, so the object HA needs is built here, published under this key, and re-emitted
 * verbatim by `HASS_ENTITY_VALUE_TEMPLATE` in `Hass.ts`. Publishing the progress keys
 * at the top level of the flattened payload instead would do nothing at all: the old
 * scalar `value_template` collapsed the payload to a version string before HA ever
 * looked for them.
 */
export const HASS_UPDATE_STATE_KEY = 'update_state';

export interface HassUpdateProgress {
  in_progress: boolean;
  update_percentage: number | null;
}

/**
 * Phase-to-percentage ladder for the HA progress bar (#210).
 *
 * Drydock's update operations report discrete phases, not measurable work, and the
 * image pull exposes no byte counters at this layer, so there is nothing real to
 * compute a percentage from. These numbers are a fixed ladder over the phases in the
 * order an operation walks them (`IN_PROGRESS_CONTAINER_UPDATE_OPERATION_PHASES`),
 * monotonically increasing along the happy path so the bar advances in step with the
 * phase the drydock UI shows. They are ordinal markers, not a claim about elapsed
 * work or remaining time.
 *
 * The rollback and Portainer-restore phases sit at 90 rather than continuing upward:
 * they are late in the operation but they are not progress toward a completed update.
 *
 * A phase with no entry here — a future phase added without updating this map —
 * publishes `update_percentage: null` alongside `in_progress: true`, which is HA's
 * indeterminate spinner. The operation stays visibly running, just without a bar.
 */
export const HASS_UPDATE_PERCENTAGE_BY_PHASE: Partial<
  Record<ContainerUpdateOperationPhase, number>
> = {
  queued: 5,
  pulling: 10,
  scanning: 30,
  'sbom-generating': 35,
  prepare: 40,
  renamed: 50,
  'new-created': 60,
  'old-stopped': 70,
  'new-started': 80,
  'health-gate': 85,
  'health-gate-passed': 95,
  'rollback-started': 90,
  'rollback-deferred': 90,
  'portainer-target': 60,
  'portainer-restore': 90,
};

/**
 * Turn the container's currently active update operation, if any, into HA's two
 * progress fields.
 *
 * No active operation means no update in flight, which publishes `in_progress: false`
 * and `update_percentage: null`. That includes every terminal outcome — succeeded,
 * failed, rolled back, expired, skipped — because none of them leaves an active
 * operation behind, so a failure and a rollback clear the spinner exactly like a
 * success does while leaving the installed and latest versions to the container
 * payload.
 *
 * The caller reads the active operation from the operation store on every publish
 * rather than remembering "we saw a terminal event". A remembered flag strands the
 * entity spinning forever whenever the terminal event is missed, whether by a
 * restart mid-update, a container the event could not be resolved back to, or an
 * operation swept out by the active TTL; deriving it fresh means the worst case is
 * one stale publish, corrected by the next one.
 */
export function getHassUpdateProgress(
  activeOperation: { phase?: ContainerUpdateOperationPhase } | undefined,
): HassUpdateProgress {
  if (!activeOperation) {
    return { in_progress: false, update_percentage: null };
  }
  const percentage = activeOperation.phase
    ? HASS_UPDATE_PERCENTAGE_BY_PHASE[activeOperation.phase]
    : undefined;
  return {
    in_progress: true,
    update_percentage: percentage ?? null,
  };
}

/**
 * Build the whole HA `update` object for a container's state payload: the installed
 * version plus the two progress fields, and nothing else the whitelist schema would
 * reject.
 *
 * `installed_version` is omitted rather than published empty when the container has
 * no tag value, because HA leaves an absent key at its previous value but happily
 * accepts an empty string as the installed version — which renders the entity's
 * version as blank instead of keeping the last good one.
 */
export function buildHassUpdateState({
  installedVersion,
  progress,
}: {
  installedVersion?: unknown;
  progress: HassUpdateProgress;
}): Record<string, unknown> {
  return {
    ...(typeof installedVersion === 'string' && installedVersion !== ''
      ? { installed_version: installedVersion }
      : {}),
    ...progress,
  };
}
