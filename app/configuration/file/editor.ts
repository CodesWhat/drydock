import { readFile } from 'node:fs/promises';
import { REDACTED_VALUE } from '../../debug/redact.js';
import { resolveCandidateEnvAndDiff } from './candidate.js';
import {
  type ConfigurationEditFieldDescriptor,
  configurationRevision,
  readEditorDocument,
  watcherSnapshot,
} from './editor-snapshot.js';
import { notificationTriggerSnapshot } from './editor-trigger-snapshot.js';
import { flattenConfigTree } from './flatten.js';
import { interpolateConfigTree } from './interpolate.js';
import { reloadConfiguration } from './reload.js';
import { validateConfiguration } from './validate.js';
import { withConfigurationWrite, writeFileAtomically } from './write.js';

interface WatcherChange {
  path: string[];
  operation: 'set' | 'remove';
  value?: string | number | boolean;
}

function changesFromRequest(
  request: unknown,
): { revision: string; changes: WatcherChange[] } | undefined {
  if (!request || typeof request !== 'object') return undefined;
  const body = request as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !['revision', 'changes'].includes(key)) ||
    typeof body.revision !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.revision) ||
    !Array.isArray(body.changes) ||
    body.changes.length < 1 ||
    body.changes.length > 32
  )
    return undefined;
  const paths: string[][] = [];
  for (const change of body.changes) {
    if (
      !change ||
      typeof change !== 'object' ||
      Object.keys(change).some((key) => !['path', 'operation', 'value'].includes(key))
    )
      return undefined;
    if (
      !Array.isArray(change.path) ||
      change.path.length < 3 ||
      change.path.length > 5 ||
      change.path.some(
        (part: unknown) =>
          typeof part !== 'string' ||
          !/^[A-Za-z0-9_]+$/.test(part) ||
          ['__proto__', 'constructor', 'prototype'].includes(part.toLowerCase()),
      )
    )
      return undefined;
    if (change.operation === 'set') {
      if (
        !['string', 'number', 'boolean'].includes(typeof change.value) ||
        (typeof change.value === 'number' && !Number.isFinite(change.value)) ||
        change.value === REDACTED_VALUE
      )
        return undefined;
    } else if (change.operation !== 'remove' || Object.hasOwn(change, 'value')) return undefined;
    if (
      paths.some((previous) =>
        previous
          .slice(0, Math.min(previous.length, change.path.length))
          .every((part, index) => part === change.path[index]),
      )
    )
      return undefined;
    paths.push(change.path);
  }
  return body as unknown as { revision: string; changes: WatcherChange[] };
}

function refusal(status: number, message: string) {
  return {
    status,
    saved: false,
    applied: false,
    revision: undefined as string | undefined,
    changedKeys: [] as string[],
    restartRequired: [] as string[],
    errors: [{ path: 'document', envKey: 'DD_CONFIG_FILE', message }],
  };
}

export async function getWatcherEditSnapshot() {
  return watcherSnapshot(await readEditorDocument());
}

export async function getNotificationTriggerEditSnapshot() {
  return notificationTriggerSnapshot(await readEditorDocument());
}

export async function writeNotificationTriggerEdits(request: unknown) {
  return writeEditorEdits(request, 'triggers');
}

async function performEdits(request: unknown, editor: 'watchers' | 'triggers') {
  const body = changesFromRequest(request);
  if (!body)
    return refusal(
      400,
      editor === 'watchers'
        ? 'Invalid watcher edit request'
        : 'Invalid notification policy edit request',
    );
  const document = await readEditorDocument();
  if (!document) return refusal(409, 'No configuration file is available to edit');
  if (body.revision !== document.revision)
    return refusal(409, 'Configuration changed; reload the editor');
  const rows: Array<{ fields: Record<string, ConfigurationEditFieldDescriptor> }> =
    editor === 'watchers'
      ? watcherSnapshot(document).watchers
      : notificationTriggerSnapshot(document).triggers;
  const allowedPaths = rows.flatMap((row) =>
    Object.values(row.fields).flatMap((field) => (field.path ? [JSON.stringify(field.path)] : [])),
  );
  if (body.changes.some((change) => !allowedPaths.includes(JSON.stringify(change.path))))
    return refusal(409, 'A requested field is not editable');
  for (const change of body.changes) {
    if (change.operation === 'remove') document.doc.deleteIn(change.path);
    else document.doc.setIn(change.path, change.value);
  }
  const interpolated = interpolateConfigTree(document.doc.toJS({ maxAliasCount: 100 }));
  const candidate = await resolveCandidateEnvAndDiff(
    flattenConfigTree(interpolated.tree),
    interpolated.interpolatedKeys,
  );
  const validation = await validateConfiguration(candidate.candidateEnv);
  if (validation.errors.length)
    return {
      ...refusal(400, 'Configuration validation failed'),
      errors: validation.errors.map(({ path, envKey }) => ({
        path,
        envKey,
        message: 'Invalid configuration value',
      })),
    };
  if (configurationRevision(await readFile(document.path)) !== body.revision)
    return refusal(409, 'Configuration changed; reload the editor');
  const raw = document.doc.toString();
  await writeFileAtomically(document.path, raw);
  const saved = {
    status: 200,
    saved: true,
    revision: configurationRevision(raw),
    changedKeys: candidate.diff.changed,
    restartRequired: candidate.diff.restart,
  };
  try {
    const reload = await reloadConfiguration();
    const reconcile = reload.reconcile;
    const applied = reload.applied && (!reconcile || reconcile.errors.length === 0);
    const errors = applied
      ? []
      : [
          {
            path: 'document',
            envKey: 'DD_CONFIG_FILE',
            message: 'Configuration saved but runtime reload was incomplete',
          },
        ];
    return {
      ...saved,
      applied,
      errors,
      reload: {
        applied,
        errors,
        ...(reconcile
          ? {
              reconcile: {
                added: reconcile.added.length,
                changed: reconcile.changed.length,
                removed: reconcile.removed.length,
                unchanged: reconcile.unchanged.length,
                errors: reconcile.errors.length,
              },
            }
          : {}),
        orphanedRules: reload.orphanedRules,
      },
    };
  } catch {
    const errors = [
      {
        path: 'document',
        envKey: 'DD_CONFIG_FILE',
        message: 'Configuration saved but runtime reload failed',
      },
    ];
    return { ...saved, applied: false, errors, reload: { applied: false, errors } };
  }
}

export async function writeWatcherEdits(request: unknown) {
  return writeEditorEdits(request, 'watchers');
}

async function writeEditorEdits(request: unknown, editor: 'watchers' | 'triggers') {
  return withConfigurationWrite(async () => {
    try {
      return await performEdits(request, editor);
    } catch {
      return refusal(
        500,
        editor === 'watchers'
          ? 'Unable to save watcher configuration'
          : 'Unable to save notification policy configuration',
      );
    }
  });
}
