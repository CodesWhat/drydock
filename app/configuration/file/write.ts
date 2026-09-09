import { randomUUID } from 'node:crypto';
import { chmod, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import yaml, { isMap, isScalar } from 'yaml';
import { configFileSources } from '../index.js';
import { resolveCandidateEnvAndDiff } from './candidate.js';
import { ddEnvKeyToSection, RELOADABLE_SECTIONS } from './diff.js';
import { flattenConfigTree } from './flatten.js';
import { interpolateConfigTree } from './interpolate.js';
import { getConfigFileInfo } from './layer.js';
import { type ConfigurationReloadResult, reloadConfiguration } from './reload.js';
import { type ConfigurationValidationResult, validateConfiguration } from './validate.js';

/**
 * `PUT /api/v1/config/:section`'s engine (roadmap 7.1 slice 7,
 * spec-7.1-config-file.md section 4.4): validate a candidate section body
 * against the real component schemas, mutate the parsed `yaml` `Document` in
 * place — so an operator's comments and key order survive everywhere except
 * the section actually being replaced — write it atomically, and reload
 * (slice 6's `reloadConfiguration`) so the change takes effect immediately
 * wherever it can.
 *
 * Two refusals are 409, matching section 4.4: a key whose effective value
 * comes from `env` (writing it would be a silent no-op, since env still
 * wins) and a section this file doesn't own (anything in section 3's DB
 * column — that lives behind `PATCH /api/v1/settings` and its siblings, not
 * this endpoint). A third, `no-file`, is also 409: this endpoint never
 * creates `drydock.yml` — an operator who wants one has to mount it first.
 * An invalid candidate is reported the same way `/validate` and `/reload`
 * already report one: a `path`/`envKey`/`message` triple per Joi rejection,
 * never a generic parse failure with no detail.
 */

// Mirrors CONFIG_FILE_MAX_ALIAS_COUNT in ./loader.ts and CANDIDATE_MAX_ALIAS_COUNT
// in ../../api/config-validate.ts. Duplicated for the same reason those two
// already duplicate it: this stays as low in the module graph as its siblings.
const CONFIG_FILE_MAX_ALIAS_COUNT = 100;

// spec-7.1-config-file.md section 3's DB column: settings, ui_preferences,
// notification_rules (+ its two join tables), api_keys, approvals,
// containers. Named both with and without underscores since a URL path
// segment is whatever the caller typed, not a value this codebase derives —
// unlike a real DD_* section name, there's no canonical spelling to lower
// against. None of these collide with an actual DD_<SECTION>_* prefix today;
// this is a denylist against someone trying to write DB-owned state through
// the file endpoint, not a defense against an accidental name clash.
const DB_OWNED_SECTIONS = new Set([
  'settings',
  'ui_preferences',
  'uipreferences',
  'notification_rules',
  'notificationrules',
  'api_keys',
  'apikeys',
  'approvals',
  'containers',
]);

interface ConfigWriteWritten {
  kind: 'written';
  /** `DD_*` keys under this section whose effective value changed. */
  changedKeys: string[];
  /** True when this section only takes effect after a restart (section
   * 4.3's table) — the file was still written; nothing here failed. */
  restartRequired: boolean;
  reload: ConfigurationReloadResult;
}

interface ConfigWriteNoFile {
  kind: 'no-file';
}

interface ConfigWriteInvalid {
  kind: 'invalid';
  errors: ConfigurationValidationResult['errors'];
}

interface ConfigWriteEnvSourced {
  kind: 'env-sourced';
  /** `DD_*` keys this write would set that are actually sourced from the
   * real environment — writing them to the file would be a silent no-op. */
  keys: string[];
}

interface ConfigWriteDbOwned {
  kind: 'db-owned';
  section: string;
}

export type ConfigWriteOutcome =
  | ConfigWriteWritten
  | ConfigWriteNoFile
  | ConfigWriteInvalid
  | ConfigWriteEnvSourced
  | ConfigWriteDbOwned;

function singleDocumentError(message: string): ConfigurationValidationResult['errors'] {
  // Mirrors config-validate.ts's own fallback: no single YAML path or DD_*
  // key exists yet for a whole-document failure (a body that doesn't
  // flatten cleanly), so DD_CONFIG_FILE is the closest DD_* key to "the
  // document itself" that exists.
  return [{ path: 'document', envKey: 'DD_CONFIG_FILE', message }];
}

/**
 * The existing top-level key naming this section in the document, matched
 * case-insensitively since a hand-written file's casing is the operator's
 * choice and flattening already lowercases every segment regardless of it.
 * Falls back to `section` itself (creating a new top-level key) when no
 * existing key matches, including when the document is empty.
 */
function findExistingSectionKey(
  doc: ReturnType<typeof yaml.parseDocument>,
  section: string,
): string {
  const contents = doc.contents;
  if (!isMap(contents)) {
    return section;
  }
  for (const item of contents.items) {
    if (isScalar(item.key) && typeof item.key.value === 'string') {
      if (item.key.value.toLowerCase() === section.toLowerCase()) {
        return item.key.value;
      }
    }
  }
  return section;
}

/**
 * Write `content` to a sibling temp file in the same directory as
 * `targetPath` — required for an atomic `rename` on the same filesystem —
 * `fsync` it, `chmod 0600`, then `rename` it into place. The temp file is
 * unlinked on any failure before or during that sequence so a failed write
 * never leaves debris behind; a failure at any point before `rename` leaves
 * `targetPath` itself completely untouched, which is the whole point of
 * writing beside it first instead of in place.
 */
export async function writeFileAtomically(targetPath: string, content: string): Promise<void> {
  const tempPath = join(dirname(targetPath), `.${basename(targetPath)}.tmp-${randomUUID()}`);
  const handle = await open(tempPath, 'w', 0o600);
  try {
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(tempPath, 0o600);
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function performWrite(section: string, sectionBody: unknown): Promise<ConfigWriteOutcome> {
  const sectionNormalized = section.trim().toLowerCase();

  if (DB_OWNED_SECTIONS.has(sectionNormalized)) {
    return { kind: 'db-owned', section: sectionNormalized };
  }

  const fileInfo = getConfigFileInfo();
  if (!fileInfo) {
    return { kind: 'no-file' };
  }

  const raw = await readFile(fileInfo.path, 'utf-8');
  const doc = yaml.parseDocument(raw, { uniqueKeys: true, merge: false });
  const existingTree = (doc.toJS({ maxAliasCount: CONFIG_FILE_MAX_ALIAS_COUNT }) ?? {}) as Record<
    string,
    unknown
  >;
  const sectionKey = findExistingSectionKey(doc, sectionNormalized);

  // A Map, not `{ ...existingTree, [sectionKey]: sectionBody }`: sectionKey
  // is the `:section` URL path segment (or an existing document key matched
  // against it), so it's caller-controlled the same way sources.ts's
  // fileLayer keys are, and an object-literal computed property is a sink
  // CodeQL's js/remote-property-injection flags regardless of whether the
  // key could actually repoint a prototype. Map.set has no such sink;
  // Object.fromEntries below converts back the same way sources.ts and
  // interpolate.ts already do.
  const candidateTreeEntries = new Map<string, unknown>(Object.entries(existingTree));
  candidateTreeEntries.set(sectionKey, sectionBody);
  const candidateTree: Record<string, unknown> = Object.fromEntries(candidateTreeEntries);

  let candidateFileLayer: Record<string, string>;
  let interpolatedKeys: Set<string>;
  try {
    const interpolated = interpolateConfigTree(candidateTree);
    candidateFileLayer = flattenConfigTree(interpolated.tree);
    interpolatedKeys = interpolated.interpolatedKeys;
  } catch (error) {
    return { kind: 'invalid', errors: singleDocumentError((error as Error).message) };
  }

  const { candidateEnv, diff } = await resolveCandidateEnvAndDiff(
    candidateFileLayer,
    interpolatedKeys,
  );
  const validationResult = await validateConfiguration(candidateEnv);
  if (validationResult.errors.length > 0) {
    return { kind: 'invalid', errors: validationResult.errors };
  }

  const sectionEnvKeys = Object.keys(candidateFileLayer).filter(
    (key) => ddEnvKeyToSection(key) === sectionNormalized,
  );
  const envSourcedKeys = sectionEnvKeys.filter((key) => configFileSources[key] === 'env').sort();
  if (envSourcedKeys.length > 0) {
    return { kind: 'env-sourced', keys: envSourcedKeys };
  }

  doc.set(sectionKey, sectionBody);
  await writeFileAtomically(fileInfo.path, doc.toString());

  const reload = await reloadConfiguration();
  const changedKeys = diff.changed
    .filter((key) => ddEnvKeyToSection(key) === sectionNormalized)
    .sort();

  return {
    kind: 'written',
    changedKeys,
    restartRequired: !RELOADABLE_SECTIONS.has(sectionNormalized),
    reload,
  };
}

// Serializes concurrent writes: a second call's read-validate-write-reload
// sequence only starts once the previous one has fully settled (written or
// refused), so two overlapping PUTs to the file never interleave their reads
// and writes. A failed write must not stall every write after it, so the
// chain always continues regardless of how the previous task settled.
let writeChain: Promise<unknown> = Promise.resolve();

export async function writeConfigurationSection(
  section: string,
  sectionBody: unknown,
): Promise<ConfigWriteOutcome> {
  return withConfigurationWrite(() => performWrite(section, sectionBody));
}

export async function withConfigurationWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeChain.then(task, task);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
