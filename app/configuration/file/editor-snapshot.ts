import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import yaml, { isAlias, isMap, isScalar, type YAMLMap } from 'yaml';
import { getState } from '../../registry/index.js';
import { configFileSources, WATCHER_MAINTENANCE_ENV_ALIASES } from '../index.js';
import { getConfigFileInfo, getConfigFileLayer } from './layer.js';

const revisionKey = randomBytes(32);
const WATCHER_EDIT_FIELDS = [
  'cron',
  'maintenancewindow',
  'maintenancewindowtz',
  'maintenancewindowscope',
] as const;
type WatcherEditField = (typeof WATCHER_EDIT_FIELDS)[number];
type ScalarValue = string | number | boolean;
export interface ConfigurationEditFieldDescriptor {
  path?: string[];
  present: boolean;
  value?: ScalarValue;
  effectiveValue?: ScalarValue;
  source: string;
  readOnlyReason?: string;
}

export function configurationRevision(raw: string | Buffer): string {
  return createHmac('sha256', revisionKey).update(raw).digest('base64url');
}

export async function readEditorDocument() {
  const info = getConfigFileInfo();
  if (!info) return undefined;
  let bytes: Buffer;
  try {
    bytes = await readFile(info.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Unable to read configuration for editing');
  }
  if (bytes.length > 1024 * 1024) throw new Error('Configuration is too large to edit');
  const raw = bytes.toString('utf8');
  if (!Buffer.from(raw).equals(bytes)) throw new Error('Configuration must be UTF-8 text');
  const doc = yaml.parseDocument(raw, { uniqueKeys: true, merge: false });
  if (doc.errors.length || !isMap(doc.contents))
    throw new Error('Configuration must be a valid mapping');
  doc.toJS({ maxAliasCount: 100 });
  return { path: info.path, raw, doc, revision: configurationRevision(bytes) };
}

export function scalar(value: unknown): value is ScalarValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

export function matchingKeys(map: unknown, name: string): string[] {
  if (!isMap(map)) return [];
  return map.items.flatMap(({ key }) =>
    isScalar(key) && typeof key.value === 'string' && key.value.toLowerCase() === name
      ? [key.value]
      : [],
  );
}

function fieldPaths(map: YAMLMap, prefix: string[]): Map<WatcherEditField, string[][]> {
  const result = new Map<WatcherEditField, string[][]>();
  function visit(current: YAMLMap, segments: string[]) {
    for (const { key, value } of current.items) {
      if (!isScalar(key) || typeof key.value !== 'string') continue;
      const next = [...segments, key.value];
      const suffix = next.join('_').toUpperCase();
      const field =
        WATCHER_EDIT_FIELDS.find((name) => name.toUpperCase() === suffix) ??
        WATCHER_MAINTENANCE_ENV_ALIASES.find(([alias]) => alias === `_${suffix}`)?.[1];
      if (field) result.set(field, [...(result.get(field) ?? []), [...prefix, ...next]]);
      else if (isMap(value)) visit(value, next);
    }
  }
  visit(map, []);
  return result;
}

export function watcherSnapshot(document: Awaited<ReturnType<typeof readEditorDocument>>) {
  const watcherSections = matchingKeys(document?.doc.contents, 'watcher');
  const section = watcherSections.length === 1 ? watcherSections[0] : undefined;
  const sectionNode = section ? document?.doc.get(section, true) : undefined;
  const watchers = Object.entries(getState().watcher).map(([id, watcher]) => {
    const names = matchingKeys(sectionNode, watcher.name);
    const name = names.length === 1 ? names[0] : undefined;
    const node = section && name ? document?.doc.getIn([section, name], true) : undefined;
    const prefix = section && name ? [section, name] : undefined;
    const paths =
      prefix && isMap(node) ? fieldPaths(node, prefix) : new Map<WatcherEditField, string[][]>();
    const fields = Object.fromEntries(
      WATCHER_EDIT_FIELDS.map((field) => {
        const matches = paths.get(field) ?? [];
        const fieldPath = matches[0] ?? (prefix ? [...prefix, field] : undefined);
        const rawNode = fieldPath ? document?.doc.getIn(fieldPath, true) : undefined;
        const envKey = fieldPath
          ? `DD_${fieldPath.join('_').toUpperCase()}`
          : `DD_WATCHER_${watcher.name.toUpperCase()}_${field.toUpperCase()}`;
        const relatedEnvKeys = [
          envKey,
          `DD_WATCHER_${watcher.name.toUpperCase()}_${field.toUpperCase()}`,
          ...WATCHER_MAINTENANCE_ENV_ALIASES.filter(([, name]) => name === field).map(
            ([suffix]) => `DD_WATCHER_${watcher.name.toUpperCase()}${suffix}`,
          ),
        ];
        const reference =
          isAlias(rawNode) ||
          isMap(rawNode) ||
          (isScalar(rawNode) && typeof rawNode.value === 'string' && /^\$\{/.test(rawNode.value)) ||
          relatedEnvKeys.some(
            (key) =>
              process.env[`${key}__FILE`] !== undefined ||
              getConfigFileLayer()[`${key}__FILE`] !== undefined,
          );
        const environmentOwned = relatedEnvKeys.some(
          (key) => configFileSources[key] === 'env' || process.env[key] !== undefined,
        );
        const readOnlyReason = !document
          ? 'configuration-file-unavailable'
          : watcher.agent
            ? 'agent-watcher'
            : !isMap(node)
              ? 'watcher-not-in-file'
              : matches.length > 1
                ? 'ambiguous-field-alias'
                : reference
                  ? 'referenced-field'
                  : environmentOwned
                    ? 'environment-owned'
                    : undefined;
        const source = reference
          ? 'reference'
          : environmentOwned
            ? 'env'
            : rawNode !== undefined
              ? 'file'
              : 'default';
        const descriptor: ConfigurationEditFieldDescriptor = {
          present: rawNode !== undefined,
          source,
        };
        if (readOnlyReason) descriptor.readOnlyReason = readOnlyReason;
        else descriptor.path = fieldPath;
        if (!reference && !watcher.agent && matches.length < 2) {
          if (isScalar(rawNode) && scalar(rawNode.value)) descriptor.value = rawNode.value;
          const effective = (watcher.configuration as Record<string, unknown>)[field];
          if (scalar(effective)) descriptor.effectiveValue = effective;
        }
        return [field, descriptor];
      }),
    ) as Record<WatcherEditField, ConfigurationEditFieldDescriptor>;
    return { id, name: watcher.name, ...(watcher.agent ? { agent: watcher.agent } : {}), fields };
  });
  return {
    available: document !== undefined,
    ...(document
      ? { revision: document.revision }
      : { readOnlyReason: 'configuration-file-unavailable' }),
    watchers,
  };
}
