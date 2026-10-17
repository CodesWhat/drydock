import type { LabelOverrideFieldValue } from '../services/label-override';
import type { LabelOwnedField } from '../types/container';

type OverrideFieldKind = 'text' | 'icon' | 'name-list' | 'action' | 'trigger-list';
type TriggerCategory = 'action' | 'notification';

interface DraftProblem {
  code: string;
  entries: string[];
}

/** Trigger ids the server would accept, split by kind. `null` when the list could not load. */
interface KnownTriggers {
  action: string[];
  notification: string[];
}

const FIELD_KINDS: Record<LabelOwnedField, OverrideFieldKind> = {
  displayName: 'text',
  displayIcon: 'icon',
  dependsOn: 'name-list',
  dependsOnAction: 'action',
  notificationTriggerInclude: 'trigger-list',
  notificationTriggerExclude: 'trigger-list',
  actionTriggerInclude: 'trigger-list',
  actionTriggerExclude: 'trigger-list',
  actionTriggerAuto: 'trigger-list',
};

const TRIGGER_CATEGORIES: Partial<Record<LabelOwnedField, TriggerCategory>> = {
  notificationTriggerInclude: 'notification',
  notificationTriggerExclude: 'notification',
  actionTriggerInclude: 'action',
  actionTriggerExclude: 'action',
  actionTriggerAuto: 'action',
};

const DEPENDS_ON_ACTIONS = ['update', 'restart'] as const;

/** The twelve thresholds the server accepts after the colon. */
const ROUTING_THRESHOLDS = [
  'all',
  'major',
  'minor',
  'patch',
  'major-only',
  'minor-only',
  'digest',
  'major-no-digest',
  'minor-no-digest',
  'patch-no-digest',
  'major-only-no-digest',
  'minor-only-no-digest',
] as const;

const MAX_LIST_ENTRIES = 32;
const CONTAINER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/;
const TRIGGER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9][A-Za-z0-9_-]*){0,2}$/;

function fieldKind(field: LabelOwnedField): OverrideFieldKind {
  return FIELD_KINDS[field];
}

function triggerCategoryOf(field: LabelOwnedField): TriggerCategory | null {
  return TRIGGER_CATEGORIES[field] ?? null;
}

function isThreshold(value: string): boolean {
  return (ROUTING_THRESHOLDS as readonly string[]).includes(value.toLowerCase());
}

/** `reference` or `reference:threshold`; the threshold is empty when none was given. */
function splitRoutingEntry(entry: string): { reference: string; threshold: string } {
  const [reference, threshold] = entry.split(':');
  return { reference, threshold: threshold ?? '' };
}

function buildRoutingEntry(reference: string, threshold: string): string {
  return threshold === '' ? reference : `${reference}:${threshold}`;
}

/** The comparison form the server uses: lowercase id and threshold, `all` by default. */
function normalizeRoutingEntry(entry: string): string {
  const { reference, threshold } = splitRoutingEntry(entry);
  return `${reference.toLowerCase()}:${(threshold || 'all').toLowerCase()}`;
}

/** The server's trigger reference matching: full id, name only, or provider.name. */
function doesReferenceMatchId(reference: string, triggerId: string): boolean {
  const wanted = reference.toLowerCase();
  const parts = triggerId.toLowerCase().split('.');
  const name = parts.at(-1);
  return (
    wanted === parts.join('.') ||
    wanted === name ||
    (parts.length >= 2 && wanted === `${parts.at(-2)}.${name}`)
  );
}

function duplicatesOf(entries: string[], keyOf: (entry: string) => string): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of entries) {
    const key = keyOf(entry);
    if (seen.has(key)) duplicates.push(entry);
    seen.add(key);
  }
  return duplicates;
}

/** The server's `dependsOn` rules. Names that are not running now are fine. */
function validateNameListDraft(names: string[], scopeNames: string[]): DraftProblem[] {
  if (names.length > MAX_LIST_ENTRIES) return [{ code: 'too-many-entries', entries: [] }];
  const problems: DraftProblem[] = [];
  const invalid = names.filter((name) => !CONTAINER_NAME_PATTERN.test(name));
  if (invalid.length > 0) problems.push({ code: 'invalid-name', entries: invalid });
  const duplicates = duplicatesOf(names, (name) => name);
  if (duplicates.length > 0) problems.push({ code: 'duplicate-entry', entries: duplicates });
  const self = names.filter((name) => scopeNames.includes(name));
  if (self.length > 0) problems.push({ code: 'depends-on-self', entries: self });
  return problems;
}

/**
 * The server's routing rules. The known-trigger check only runs when the trigger list
 * loaded; otherwise the server's answer is the only one.
 */
function validateRoutingDraft(
  entries: string[],
  category: TriggerCategory,
  known: KnownTriggers | null,
): DraftProblem[] {
  if (entries.length > MAX_LIST_ENTRIES) return [{ code: 'too-many-entries', entries: [] }];
  const problems: DraftProblem[] = [];
  const parts = entries.map((entry) => entry.split(':'));
  const badReference = entries.filter(
    (_, index) => parts[index].length > 2 || !TRIGGER_REFERENCE_PATTERN.test(parts[index][0]),
  );
  if (badReference.length > 0) problems.push({ code: 'invalid-reference', entries: badReference });
  const badThreshold = entries.filter(
    (_, index) =>
      parts[index].length === 2 &&
      TRIGGER_REFERENCE_PATTERN.test(parts[index][0]) &&
      !isThreshold(parts[index][1]),
  );
  if (badThreshold.length > 0) problems.push({ code: 'invalid-threshold', entries: badThreshold });
  const duplicates = duplicatesOf(entries, normalizeRoutingEntry);
  if (duplicates.length > 0) problems.push({ code: 'duplicate-entry', entries: duplicates });
  if (known !== null) {
    const other = category === 'action' ? known.notification : known.action;
    const unknown: string[] = [];
    const wrongCategory: string[] = [];
    entries.forEach((entry, index) => {
      if (badReference.includes(entry)) return;
      const reference = parts[index][0];
      if (known[category].some((id) => doesReferenceMatchId(reference, id))) return;
      (other.some((id) => doesReferenceMatchId(reference, id)) ? wrongCategory : unknown).push(
        entry,
      );
    });
    if (unknown.length > 0) problems.push({ code: 'unknown-trigger-reference', entries: unknown });
    if (wrongCategory.length > 0) {
      problems.push({ code: 'wrong-trigger-category', entries: wrongCategory });
    }
  }
  return problems;
}

function declaredRoutingEntries(value: LabelOverrideFieldValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

interface ParsedReference {
  id: string;
  threshold: string;
}

/** A declared label entry as the matcher reads it: an unsupported threshold means `all`. */
function parseDeclared(entry: string): ParsedReference {
  const { reference, threshold } = splitRoutingEntry(entry.trim());
  const lowered = threshold.trim().toLowerCase();
  return { id: reference.trim().toLowerCase(), threshold: isThreshold(lowered) ? lowered : 'all' };
}

function isIdSuffix(shorter: string, longer: string): boolean {
  const short = shorter.split('.');
  const long = longer.split('.');
  return (
    short.length <= long.length && short.every((part, i) => part === long.at(i - short.length))
  );
}

function firstOverlapping(reference: string, declared: string[]): ParsedReference | undefined {
  const id = reference.toLowerCase();
  return declared
    .map(parseDeclared)
    .find((entry) => isIdSuffix(entry.id, id) || isIdSuffix(id, entry.id));
}

/** Whether an include or auto entry stays inside the declared list under first match. */
function isEntryPermittedByDeclared(entry: string, declared: string[]): boolean {
  const { reference, threshold } = splitRoutingEntry(entry);
  const first = firstOverlapping(reference, declared);
  return (
    first !== undefined &&
    first.id === reference.toLowerCase() &&
    (first.threshold === 'all' || first.threshold === (threshold || 'all').toLowerCase())
  );
}

/** The thresholds a narrowing entry for this reference may carry; empty when none is allowed. */
function permittedThresholds(reference: string, declared: string[]): string[] {
  const first = firstOverlapping(reference, declared);
  if (first === undefined || first.id !== reference.toLowerCase()) return [];
  return first.threshold === 'all' ? [...ROUTING_THRESHOLDS] : [first.threshold];
}

function declaredKey(entry: string): string {
  const parsed = parseDeclared(entry);
  return `${parsed.id}:${parsed.threshold}`;
}

/**
 * The server's restrict-only rule for action routing on a traditional agent. An exclude must
 * start with the declared entries; an include or auto entry must be permitted by the declared
 * list, and an include can't be emptied while the labels declare one.
 */
function agentRestrictionProblems(
  field: LabelOwnedField,
  entries: string[],
  declared: string[],
): DraftProblem[] {
  const declaredKeys = declared.map(declaredKey);
  const widening = (offending: string[]): DraftProblem[] =>
    offending.length === 0 ? [] : [{ code: 'agent-enforced-widening', entries: offending }];
  if (field === 'actionTriggerExclude') {
    const keys = entries.map(normalizeRoutingEntry);
    const missing = declaredKeys.filter((key) => !keys.includes(key));
    return widening(
      missing.length > 0 ? missing : declaredKeys.filter((key, index) => keys[index] !== key),
    );
  }
  if (field === 'actionTriggerInclude' && entries.length === 0) return widening(declaredKeys);
  if (field === 'actionTriggerInclude' || field === 'actionTriggerAuto') {
    return widening(
      entries
        .filter((entry) => !isEntryPermittedByDeclared(entry, declared))
        .map(normalizeRoutingEntry),
    );
  }
  return [];
}

export {
  agentRestrictionProblems,
  buildRoutingEntry,
  DEPENDS_ON_ACTIONS,
  type DraftProblem,
  declaredRoutingEntries,
  fieldKind,
  isEntryPermittedByDeclared,
  type KnownTriggers,
  MAX_LIST_ENTRIES,
  normalizeRoutingEntry,
  permittedThresholds,
  ROUTING_THRESHOLDS,
  splitRoutingEntry,
  triggerCategoryOf,
  validateNameListDraft,
  validateRoutingDraft,
};
