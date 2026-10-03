/**
 * Request and value validation for label overrides (spec 7.5). Pure: nothing here reads the
 * store or the registry, so every rule is testable on its own. Rules that need the live
 * container list or trigger registry (references, cycles, agent enforcement) are in
 * `./references.ts`.
 *
 * Field names go through the `LABEL_OWNED_FIELDS` registry Map and values are built into
 * fresh arrays and strings, so no request input ever becomes a computed object key.
 */
import {
  getLabelOwnedFieldSpec,
  type LabelOverrideValue,
  type LabelOwnedField,
} from '../../model/label-owned.js';
import { SUPPORTED_THRESHOLDS } from '../../triggers/providers/trigger-threshold.js';
import { ICON_SLUG_PATTERN } from '../icons/validation.js';

export interface FieldError {
  field: string;
  code: string;
  /** The offending list entries, for codes about a list. */
  entries?: string[];
}

export type ParsedChange =
  | { field: LabelOwnedField; op: 'set'; value: LabelOverrideValue }
  | { field: LabelOwnedField; op: 'remove' };

type ParsedPatchBody =
  | { ok: true; revision: number; changes: ParsedChange[] }
  | { ok: false; errors: FieldError[] };

type ValueResult = { value: LabelOverrideValue } | { code: string; entries?: string[] };

const MAX_CHANGES = 9;
const MAX_LIST_ENTRIES = 32;
const MAX_DISPLAY_NAME_CODE_POINTS = 128;
const ICON_PATTERN = /^(sh|hl|si)[:-](.+)$/i;
const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/;
const TRIGGER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9][A-Za-z0-9_-]*){0,2}$/;
const DEPENDS_ON_ACTIONS: readonly unknown[] = ['update', 'restart'];

function isForbiddenInDisplayName(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0x3c ||
    codePoint === 0x3e
  );
}

function validateDisplayName(value: unknown): ValueResult {
  if (typeof value !== 'string') {
    return { code: 'invalid-type' };
  }
  const trimmed = value.trim();
  const codePoints = [...trimmed];
  if (codePoints.length === 0) {
    return { code: 'display-name-empty' };
  }
  if (codePoints.length > MAX_DISPLAY_NAME_CODE_POINTS) {
    return { code: 'display-name-too-long' };
  }
  if (
    codePoints.some((character) => isForbiddenInDisplayName(character.codePointAt(0) as number))
  ) {
    return { code: 'display-name-invalid-characters' };
  }
  return { value: trimmed };
}

function validateIcon(value: unknown): ValueResult {
  const match = typeof value === 'string' ? ICON_PATTERN.exec(value) : null;
  if (match === null || !ICON_SLUG_PATTERN.test(match[2])) {
    return { code: 'invalid-icon' };
  }
  return { value: `${match[1].toLowerCase()}:${match[2]}` };
}

function describeEntries(entries: unknown[]): string[] {
  return entries.map((entry) => String(entry));
}

function validateDependsOn(value: unknown): ValueResult {
  if (!Array.isArray(value)) {
    return { code: 'invalid-type' };
  }
  if (value.length > MAX_LIST_ENTRIES) {
    return { code: 'too-many-entries' };
  }
  const invalid = value.filter(
    (entry) => typeof entry !== 'string' || !CONTAINER_NAME_PATTERN.test(entry),
  );
  if (invalid.length > 0) {
    return { code: 'invalid-name', entries: describeEntries(invalid) };
  }
  const names = value as string[];
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    return { code: 'duplicate-entry', entries: duplicates };
  }
  return { value: [...names] };
}

function splitRoutingEntry(entry: string): { reference: string; threshold?: string } | undefined {
  const parts = entry.split(':');
  if (parts.length > 2 || !TRIGGER_REFERENCE_PATTERN.test(parts[0])) {
    return undefined;
  }
  return { reference: parts[0], threshold: parts[1] };
}

/**
 * The comparison form of a routing entry: lowercased id plus threshold, `all` by default.
 * Duplicate detection and the agent restrict-only check both compare these.
 */
export function normalizeRoutingEntry(entry: string): string {
  const [reference, threshold] = entry.split(':');
  return `${reference.toLowerCase()}:${(threshold ?? 'all').toLowerCase()}`;
}

function validateRoutingList(value: unknown): ValueResult {
  if (!Array.isArray(value)) {
    return { code: 'invalid-type' };
  }
  if (value.length > MAX_LIST_ENTRIES) {
    return { code: 'too-many-entries' };
  }
  const parsed = value.map((entry) =>
    typeof entry === 'string' ? splitRoutingEntry(entry) : undefined,
  );
  const badReferences = value.filter((_, index) => parsed[index] === undefined);
  if (badReferences.length > 0) {
    return { code: 'invalid-reference', entries: describeEntries(badReferences) };
  }
  const badThresholds = value.filter((_, index) => {
    const threshold = parsed[index]?.threshold;
    return (
      threshold !== undefined &&
      !(SUPPORTED_THRESHOLDS as readonly string[]).includes(threshold.toLowerCase())
    );
  });
  if (badThresholds.length > 0) {
    return { code: 'invalid-threshold', entries: describeEntries(badThresholds) };
  }
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const stored = (value as string[]).map((entry) => {
    const key = normalizeRoutingEntry(entry);
    if (seen.has(key)) {
      duplicates.push(entry);
    }
    seen.add(key);
    const [reference, threshold] = entry.split(':');
    return threshold === undefined ? reference : `${reference}:${threshold.toLowerCase()}`;
  });
  if (duplicates.length > 0) {
    return { code: 'duplicate-entry', entries: duplicates };
  }
  return { value: stored };
}

/** Syntax check and normalization of one override value for its field. */
export function validateOverrideValue(field: string, value: unknown): ValueResult {
  const spec = getLabelOwnedFieldSpec(field);
  switch (spec?.kind) {
    case undefined:
      return { code: 'unknown-field' };
    case 'text':
      return validateDisplayName(value);
    case 'icon':
      return validateIcon(value);
    case 'name-list':
      return validateDependsOn(value);
    case 'action':
      return DEPENDS_ON_ACTIONS.includes(value)
        ? { value: value as string }
        : { code: 'invalid-action' };
    default:
      return validateRoutingList(value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseChange(
  change: unknown,
  seen: Set<string>,
  errors: FieldError[],
): ParsedChange | undefined {
  if (!isPlainObject(change) || typeof change.field !== 'string') {
    errors.push({ field: 'changes', code: 'invalid-change' });
    return undefined;
  }
  const field = change.field;
  const spec = getLabelOwnedFieldSpec(field);
  if (spec === undefined) {
    errors.push({ field, code: 'unknown-field' });
    return undefined;
  }
  if (seen.has(field)) {
    if (!errors.some((error) => error.field === field && error.code === 'duplicate-field')) {
      errors.push({ field, code: 'duplicate-field' });
    }
    return undefined;
  }
  seen.add(field);
  if (change.op === 'remove') {
    if (Object.hasOwn(change, 'value')) {
      errors.push({ field, code: 'value-on-remove' });
      return undefined;
    }
    return { field: spec.field, op: 'remove' };
  }
  if (change.op !== 'set') {
    errors.push({ field, code: 'invalid-op' });
    return undefined;
  }
  if (!Object.hasOwn(change, 'value')) {
    errors.push({ field, code: 'missing-value' });
    return undefined;
  }
  const result = validateOverrideValue(field, change.value);
  if ('code' in result) {
    errors.push({ field, ...result });
    return undefined;
  }
  return { field: spec.field, op: 'set', value: result.value };
}

/**
 * Parse a PATCH body into typed changes, or every problem found. At most nine changes, one
 * per field; a duplicate, an unknown field, a value on a remove and a set with no value are
 * all rejected.
 */
export function parsePatchBody(body: unknown): ParsedPatchBody {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', code: 'invalid-body' }] };
  }
  const errors: FieldError[] = [];
  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    errors.push({ field: 'revision', code: 'invalid-revision' });
  }
  const rawChanges = body.changes;
  const changes: ParsedChange[] = [];
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    errors.push({ field: 'changes', code: 'invalid-changes' });
  } else if (rawChanges.length > MAX_CHANGES) {
    errors.push({ field: 'changes', code: 'too-many-changes' });
  } else {
    const seen = new Set<string>();
    for (const rawChange of rawChanges) {
      const parsed = parseChange(rawChange, seen, errors);
      if (parsed !== undefined) {
        changes.push(parsed);
      }
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, revision: revision as number, changes };
}
