/**
 * Label override API (spec 7.5): durable Drydock-owned overrides of the nine label-owned
 * container fields, per container identity. Reads are `read` scoped. Writes are `admin`,
 * not `containers:update`, because a routing override can grant automatic execution and
 * redirect notifications: a key that may only request updates must not be able to
 * configure automatic updates for itself.
 *
 * A write and its audit row commit in one transaction, so a saved change is never reported
 * as failed and an unaudited change is never saved. Saving rewrites stored container rows
 * only. It never calls Docker, never writes a Compose file and never runs a trigger.
 */
import express, { type Request, type Response } from 'express';
import nocache from 'nocache';
import logger from '../log/index.js';
import { sanitizeLogParam } from '../log/sanitize.js';
import { type Container, isRollbackContainerName } from '../model/container.js';
import {
  getLabelOwnedFieldSpec,
  isAgentEnforcedWatcher,
  type LabelOverrideFields,
  type LabelOwnedField,
} from '../model/label-owned.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import * as labelOverrideStore from '../store/label-override.js';
import { recordAuditEvent } from './audit-events.js';
import { getPathParamValue } from './container/request-helpers.js';
import { sendErrorResponse } from './error-response.js';
import { sanitizeApiError } from './helpers.js';
import {
  checkAgentRestriction,
  checkRoutingReferences,
  evaluateDependencyOverride,
  type OverrideWarning,
  toTriggerInfos,
} from './label-override/references.js';
import {
  buildAuditDetails,
  buildRow,
  buildSnapshot,
  resolveLabelOwnedState,
} from './label-override/snapshot.js';
import { type FieldError, type ParsedChange, parsePatchBody } from './label-override/validation.js';
import { scoped } from './route-scopes.js';

const log = logger.child({ component: 'api.label-override' });

const CONTAINER_NOT_FOUND_MESSAGE = 'Container not found';
const OVERRIDE_NOT_FOUND_MESSAGE = 'Label override not found';
const INVALID_REQUEST_MESSAGE = 'Invalid label override request';
const STALE_REVISION_MESSAGE =
  'Label overrides were changed by someone else. Reload them and apply the change again';
const ROLLBACK_MESSAGE = 'A temporary rollback container cannot have label overrides';
const NO_SCOPE_MESSAGE = 'The container has no label override scope';
const CYCLE_MESSAGE = 'The dependencies would create a cycle';

function getPrincipalName(req: Request): string {
  const principal = req.principal;
  return principal?.kind === 'api-key'
    ? `api-key:${principal.keyId}`
    : `user:${principal?.username ?? 'unknown'}`;
}

interface Target {
  container: Container;
  scope: labelOverrideStore.LabelOverrideScope;
}

/** Everything a response about one scope needs, read once. */
interface ScopeContext extends Target {
  record: labelOverrideStore.LabelOverrideRecord | undefined;
  containers: Container[];
  members: Container[];
  readOnlyReason: 'rollback-container' | null;
}

function loadScopeContext(target: Target): ScopeContext {
  const containers = storeContainer.getContainers();
  const members = containers
    .filter(
      (candidate) =>
        !isRollbackContainerName(candidate.name) &&
        labelOverrideStore.deriveLabelOverrideScope(candidate)?.key === target.scope.key,
    )
    .sort((first, second) => first.name.localeCompare(second.name));
  return {
    ...target,
    record: labelOverrideStore.getLabelOverrideForScope(target.scope.key),
    containers,
    members,
    readOnlyReason: isRollbackContainerName(target.container.name) ? 'rollback-container' : null,
  };
}

function snapshotOf(context: ScopeContext) {
  const state = registry.getState();
  return buildSnapshot({
    container: context.container,
    scope: context.scope,
    record: context.record,
    members: context.members.map((member) => ({ id: member.id, name: member.name })),
    agentEnforcedActionRouting: isAgentEnforcedWatcher(context.container, state.watcher),
    triggers: toTriggerInfos(state.trigger),
    readOnlyReason: context.readOnlyReason,
  });
}

function sendInvalid(res: Response, errors: FieldError[]) {
  res.status(400).json({ error: INVALID_REQUEST_MESSAGE, errors });
}

function sendStale(res: Response, context: ScopeContext) {
  res.status(409).json({ error: STALE_REVISION_MESSAGE, snapshot: snapshotOf(context) });
}

/** The container this request names, or a response already sent. */
function resolveTarget(req: Request, res: Response): Target | undefined {
  const container = storeContainer.getContainer(getPathParamValue(req.params.id));
  if (!container) {
    sendErrorResponse(res, 404, CONTAINER_NOT_FOUND_MESSAGE);
    return undefined;
  }
  const scope = labelOverrideStore.deriveLabelOverrideScope(container);
  if (!scope) {
    sendErrorResponse(res, 409, NO_SCOPE_MESSAGE);
    return undefined;
  }
  return { container, scope };
}

/** As `resolveTarget`, for a write: a rollback container is read-only. */
function resolveWritableContext(req: Request, res: Response): ScopeContext | undefined {
  const target = resolveTarget(req, res);
  if (!target) {
    return undefined;
  }
  const context = loadScopeContext(target);
  if (context.readOnlyReason !== null) {
    res.status(409).json({ error: ROLLBACK_MESSAGE, readOnlyReason: context.readOnlyReason });
    return undefined;
  }
  return context;
}

function isSameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** Changes that would alter nothing are dropped: saving what is already saved is a no-op. */
function dropNoOps(changes: ParsedChange[], current: LabelOverrideFields): ParsedChange[] {
  return changes.filter((change) => {
    const existing = current[change.field];
    return change.op === 'set'
      ? existing === undefined || !isSameValue(existing.value, change.value)
      : existing !== undefined;
  });
}

interface SemanticResult {
  errors: FieldError[];
  warnings: OverrideWarning[];
  cycle?: string[];
}

/** The checks that need live state: triggers, other containers and the agent. */
function checkChanges(context: ScopeContext, changes: ParsedChange[]): SemanticResult {
  const state = registry.getState();
  const triggers = toTriggerInfos(state.trigger);
  const enforced = isAgentEnforcedWatcher(context.container, state.watcher);
  const labelOwned = resolveLabelOwnedState(context.container, context.record?.fields);
  const scopeIds = new Set(context.members.map((member) => member.id));
  const result: SemanticResult = { errors: [], warnings: [] };
  for (const change of changes) {
    if (change.op !== 'set') {
      continue;
    }
    const spec = getLabelOwnedFieldSpec(change.field) as NonNullable<
      ReturnType<typeof getLabelOwnedFieldSpec>
    >;
    if (spec.kind === 'name-list') {
      const checked = evaluateDependencyOverride(
        change.value as string[],
        scopeIds,
        context.containers,
      );
      result.errors.push(...checked.errors);
      result.warnings.push(...checked.warnings);
      result.cycle ??= checked.cycle;
    } else if (spec.kind === 'trigger-list') {
      const entries = change.value as string[];
      const checked = checkRoutingReferences(change.field, entries, triggers, context.container);
      result.errors.push(...checked.errors);
      result.warnings.push(...checked.warnings);
      const widening = enforced
        ? checkAgentRestriction(
            change.field,
            entries,
            labelOwned.declared[change.field] as string | undefined,
          )
        : undefined;
      if (widening) {
        result.errors.push(widening);
      }
    }
  }
  return result;
}

function auditOverrideChange({
  action,
  operation,
  context,
  fields,
  before,
  after,
}: {
  action: 'label-override-set' | 'label-override-cleared';
  operation: 'patch' | 'reset-all';
  context: ScopeContext;
  fields: LabelOwnedField[];
  before: LabelOverrideFields;
  after: LabelOverrideFields;
}) {
  if (fields.length === 0) {
    return;
  }
  recordAuditEvent({
    action,
    status: 'success',
    container: context.container,
    containerIdentityKey: context.scope.key,
    details: buildAuditDetails({
      operation,
      scope: context.scope,
      fields,
      before,
      after,
      container: context.container,
      state: resolveLabelOwnedState(context.container, before),
    }),
  });
}

function respondWithSnapshot(
  res: Response,
  target: Target,
  changed: LabelOwnedField[],
  warnings: OverrideWarning[],
) {
  const snapshot = snapshotOf(loadScopeContext(target));
  res.status(200).json({ ...snapshot, changed, warnings: [...warnings, ...snapshot.warnings] });
}

function sendServerError(res: Response, error: unknown) {
  if (error instanceof labelOverrideStore.LabelOverrideValidationError) {
    sendInvalid(res, [{ field: error.field, code: 'invalid-value' }]);
    return;
  }
  log.error(`Label override request failed (${sanitizeLogParam(String(error), 500)})`);
  sendErrorResponse(res, 500, sanitizeApiError(error));
}

function getContainerLabelOverrides(req: Request, res: Response) {
  try {
    const target = resolveTarget(req, res);
    if (target) {
      res.status(200).json(snapshotOf(loadScopeContext(target)));
    }
  } catch (error: unknown) {
    sendServerError(res, error);
  }
}

function patchContainerLabelOverrides(req: Request, res: Response) {
  try {
    const parsed = parsePatchBody(req.body);
    if ('errors' in parsed) {
      sendInvalid(res, parsed.errors);
      return;
    }
    const context = resolveWritableContext(req, res);
    if (!context) {
      return;
    }
    if (parsed.revision !== (context.record?.revision ?? 0)) {
      sendStale(res, context);
      return;
    }
    const changes = dropNoOps(parsed.changes, context.record?.fields ?? {});
    if (changes.length === 0) {
      respondWithSnapshot(res, context, [], []);
      return;
    }
    const checked = checkChanges(context, changes);
    if (checked.errors.length > 0) {
      sendInvalid(res, checked.errors);
      return;
    }
    if (checked.cycle) {
      res.status(422).json({ error: CYCLE_MESSAGE, cycle: checked.cycle });
      return;
    }
    const before = context.record?.fields ?? {};
    const result = storeContainer.mutateLabelOverrides(
      context.container,
      changes,
      getPrincipalName(req),
      parsed.revision,
      (write) => {
        const after = write.record?.fields ?? {};
        auditOverrideChange({
          action: 'label-override-set',
          operation: 'patch',
          context,
          fields: changes.filter((change) => change.op === 'set').map((change) => change.field),
          before,
          after,
        });
        auditOverrideChange({
          action: 'label-override-cleared',
          operation: 'patch',
          context,
          fields: changes.filter((change) => change.op === 'remove').map((change) => change.field),
          before,
          after,
        });
      },
    );
    if (!result.applied) {
      sendStale(res, loadScopeContext(context));
      return;
    }
    respondWithSnapshot(
      res,
      context,
      changes.map((change) => change.field),
      checked.warnings,
    );
  } catch (error: unknown) {
    sendServerError(res, error);
  }
}

/** A required non-negative integer query value, as the DELETE routes take their revision. */
function parseRevisionQuery(query: unknown, minimum: number): number | undefined {
  const raw = (query as { revision?: unknown } | undefined)?.revision;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string' || !/^\d{1,15}$/.test(text)) {
    return undefined;
  }
  const revision = Number(text);
  return revision >= minimum ? revision : undefined;
}

/** The `overrideId` query value, which is a plain string or absent. */
function parseOverrideIdQuery(query: unknown): string | undefined {
  const raw = (query as { overrideId?: unknown } | undefined)?.overrideId;
  const text = Array.isArray(raw) ? raw[0] : raw;
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}

function deleteContainerLabelOverrides(req: Request, res: Response) {
  try {
    const revision = parseRevisionQuery(req.query, 0);
    if (revision === undefined) {
      sendInvalid(res, [{ field: 'revision', code: 'invalid-revision' }]);
      return;
    }
    // Deleting the last field deletes the row and the next save restarts at revision 1, so
    // a revision alone cannot tell a stale tab's row from a newer one: name the row too.
    const overrideId = parseOverrideIdQuery(req.query);
    if (revision > 0 && overrideId === undefined) {
      sendInvalid(res, [{ field: 'overrideId', code: 'invalid-override-id' }]);
      return;
    }
    const context = resolveWritableContext(req, res);
    if (!context) {
      return;
    }
    const { record } = context;
    if (record === undefined || record.revision !== revision || record.id !== overrideId) {
      if (record === undefined && revision === 0) {
        respondWithSnapshot(res, context, [], []);
      } else {
        sendStale(res, context);
      }
      return;
    }
    const result = storeContainer.deleteLabelOverrideAndRefresh(record.id, revision, (deleted) => {
      auditOverrideChange({
        action: 'label-override-cleared',
        operation: 'reset-all',
        context,
        fields: Object.keys(deleted.fields) as LabelOwnedField[],
        before: deleted.fields,
        after: {},
      });
    });
    if (result.record === undefined) {
      sendStale(res, loadScopeContext(context));
      return;
    }
    respondWithSnapshot(res, context, Object.keys(result.record.fields) as LabelOwnedField[], []);
  } catch (error: unknown) {
    sendServerError(res, error);
  }
}

/** Containers per scope key, for the list rows. */
function matchedContainers(): Map<string, Container[]> {
  const byScope = new Map<string, Container[]>();
  for (const candidate of storeContainer.getContainers()) {
    const key = labelOverrideStore.deriveLabelOverrideScope(candidate)?.key;
    if (key !== undefined && !isRollbackContainerName(candidate.name)) {
      byScope.set(key, [...(byScope.get(key) ?? []), candidate]);
    }
  }
  return byScope;
}

const idsOf = (containers: Container[] | undefined) =>
  (containers ?? []).map((candidate) => candidate.id);

function listLabelOverrides(_req: Request, res: Response) {
  try {
    const matched = matchedContainers();
    const data = labelOverrideStore
      .getLabelOverrides()
      .map((record) => buildRow(record, idsOf(matched.get(record.scopeKey))));
    res.status(200).json({ data, total: data.length });
  } catch (error: unknown) {
    sendServerError(res, error);
  }
}

function deleteLabelOverrideRow(req: Request, res: Response) {
  try {
    const revision = parseRevisionQuery(req.query, 1);
    if (revision === undefined) {
      sendInvalid(res, [{ field: 'revision', code: 'invalid-revision' }]);
      return;
    }
    const record = labelOverrideStore.getLabelOverrideById(
      getPathParamValue(req.params.overrideId),
    );
    if (!record) {
      sendErrorResponse(res, 404, OVERRIDE_NOT_FOUND_MESSAGE);
      return;
    }
    const matched = matchedContainers().get(record.scopeKey);
    const matchedIds = idsOf(matched);
    if (record.revision !== revision) {
      res
        .status(409)
        .json({ error: STALE_REVISION_MESSAGE, current: buildRow(record, matchedIds) });
      return;
    }
    const applied = matched?.[0];
    const result = storeContainer.deleteLabelOverrideAndRefresh(record.id, revision, (deleted) => {
      recordAuditEvent({
        action: 'label-override-cleared',
        status: 'success',
        containerName: deleted.scopeName,
        containerIdentityKey: deleted.scopeKey,
        details: buildAuditDetails({
          operation: 'delete-row',
          scope: {
            kind: deleted.scopeKind,
            agent: deleted.agent,
            watcher: deleted.watcher,
            name: deleted.scopeName,
          },
          fields: Object.keys(deleted.fields) as LabelOwnedField[],
          before: deleted.fields,
          after: {},
          container: applied,
          state: applied ? resolveLabelOwnedState(applied, deleted.fields) : undefined,
        }),
      });
    });
    if (result.record === undefined) {
      const current = labelOverrideStore.getLabelOverrideById(record.id);
      res.status(409).json({
        error: STALE_REVISION_MESSAGE,
        ...(current ? { current: buildRow(current, matchedIds) } : {}),
      });
      return;
    }
    res
      .status(200)
      .json({ deleted: buildRow(result.record, matchedIds), refreshed: result.refreshed });
  } catch (error: unknown) {
    sendServerError(res, error);
  }
}

/**
 * Container-scoped routes, mounted on `/api/v1/containers` ahead of the container router.
 */
export function init() {
  const router = express.Router();
  router.use(nocache());
  router.get('/:id/label-overrides', scoped('read', getContainerLabelOverrides));
  router.patch('/:id/label-overrides', scoped('admin', patchContainerLabelOverrides));
  router.delete('/:id/label-overrides', scoped('admin', deleteContainerLabelOverrides));
  return router;
}

/**
 * Top-level routes, mounted on `/api/v1/label-overrides`.
 */
export function initCollection() {
  const router = express.Router();
  router.use(nocache());
  router.get('/', scoped('read', listLabelOverrides));
  router.delete('/:overrideId', scoped('admin', deleteLabelOverrideRow));
  return router;
}
