/**
 * The one wiring of the update-policy handlers against the real store, audit log and
 * string helpers.
 *
 * `createUpdatePolicyHandlers` takes its collaborators as arguments so the handler can be
 * exercised against doubles. Two call sites need the writer now — the container router's
 * PATCH endpoint and the approval queue's reject and defer decisions — and wiring it twice
 * would be two sets of collaborators that agree by coincidence. One instance, imported by
 * both, is what makes "rejecting an update is the same operation as the Skip button" a
 * fact about the code rather than a claim in a doc.
 */
import * as storeContainer from '../../store/container.js';
import { getErrorMessage } from '../../util/error.js';
import { uniqStrings } from '../../util/string-array.js';
import { recordAuditEvent } from '../audit-events.js';
import { redactContainerRuntimeEnv } from './shared.js';
import { createUpdatePolicyHandlers } from './update-policy.js';

export const updatePolicyHandlers = createUpdatePolicyHandlers({
  storeContainer,
  uniqStrings,
  getErrorMessage,
  redactContainerRuntimeEnv,
  recordAuditEvent,
});

export const { applyContainerUpdatePolicyAction } = updatePolicyHandlers;
