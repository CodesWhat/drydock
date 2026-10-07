import { computed, type Ref, ref } from 'vue';
import { i18n } from '../boot/i18n';
import {
  getLabelOverrides,
  type LabelOverrideFieldError,
  LabelOverrideHttpError,
  type LabelOverrideSnapshot,
  type LabelOverrideValue,
  type LabelOverrideWriteResult,
  patchLabelOverrides,
  resetLabelOverrides,
} from '../services/label-override';
import type { LabelOwnedField } from '../types/container';
import { errorMessage } from '../utils/error';

type LabelOverrideFailureKind =
  | 'validation'
  | 'conflict'
  | 'forbidden'
  | 'notFound'
  | 'readOnly'
  | 'notOverridable'
  | 'cycle'
  | 'unknown';

interface LabelOverrideFailure {
  kind: LabelOverrideFailureKind;
  message: string;
  errors?: LabelOverrideFieldError[];
  cycle?: string[];
}

type LabelOverrideOutcome =
  | { ok: true; changed: LabelOwnedField[] }
  | { ok: false; failure: LabelOverrideFailure };

type LabelOverrideGroupId = 'display' | 'dependencies' | 'notification' | 'action';

const LABEL_OVERRIDE_GROUPS: { id: LabelOverrideGroupId; fields: LabelOwnedField[] }[] = [
  { id: 'display', fields: ['displayName', 'displayIcon'] },
  { id: 'dependencies', fields: ['dependsOn', 'dependsOnAction'] },
  { id: 'notification', fields: ['notificationTriggerInclude', 'notificationTriggerExclude'] },
  { id: 'action', fields: ['actionTriggerInclude', 'actionTriggerExclude', 'actionTriggerAuto'] },
];

/** Dependency and routing editors are a later slice; those fields are read-only here. */
const EDITABLE_FIELDS: ReadonlySet<LabelOwnedField> = new Set(['displayName', 'displayIcon']);

function isEditableField(field: LabelOwnedField): boolean {
  return EDITABLE_FIELDS.has(field);
}

const MAX_DISPLAY_NAME_CODE_POINTS = 128;

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

/** The server's display name rules, so a bad draft is caught before it is sent. */
function validateDisplayNameDraft(text: string): 'empty' | 'tooLong' | 'invalidCharacters' | null {
  const characters = [...text.trim()];
  if (characters.length === 0) return 'empty';
  if (characters.length > MAX_DISPLAY_NAME_CODE_POINTS) return 'tooLong';
  if (
    characters.some((character) => isForbiddenInDisplayName(character.codePointAt(0) as number))
  ) {
    return 'invalidCharacters';
  }
  return null;
}

const ICON_PROVIDERS = ['sh', 'hl', 'si'] as const;
type IconProvider = (typeof ICON_PROVIDERS)[number];

/** The slug rule the icon proxy and the override API enforce. */
const ICON_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function isValidIconSlug(slug: string): boolean {
  return ICON_SLUG_PATTERN.test(slug);
}

function buildIconValue(provider: IconProvider, slug: string): string {
  return `${provider}:${slug}`;
}

/** Split a slug-form icon into provider and slug. URLs and `mdi:` names are not slug-form. */
function parseIconValue(value: unknown): { provider: IconProvider; slug: string } | null {
  const match = typeof value === 'string' ? /^(sh|hl|si)[:-](.+)$/i.exec(value) : null;
  if (match === null || !isValidIconSlug(match[2])) {
    return null;
  }
  return { provider: match[1].toLowerCase() as IconProvider, slug: match[2] };
}

function failureFromError(error: unknown): LabelOverrideFailure {
  const message = errorMessage(error, i18n.global.t('labelOverrides.errors.unknown'));
  if (!(error instanceof LabelOverrideHttpError)) {
    return { kind: 'unknown', message };
  }
  const { status } = error;
  if (status === 400) return { kind: 'validation', message, errors: error.errors };
  if (status === 401 || status === 403) return { kind: 'forbidden', message };
  if (status === 404) return { kind: 'notFound', message };
  if (status === 409) {
    if (error.snapshot !== undefined) return { kind: 'conflict', message };
    return { kind: error.readOnlyReason === undefined ? 'notOverridable' : 'readOnly', message };
  }
  if (status === 422) return { kind: 'cycle', message, cycle: error.cycle };
  return { kind: 'unknown', message };
}

/** The server error codes about one field, in the order the server sent them. */
function fieldErrorCodes(failure: LabelOverrideFailure | null, field: LabelOwnedField): string[] {
  return (failure?.errors ?? [])
    .filter((error) => error.field === field)
    .map((error) => error.code);
}

function useLabelOverrides(containerId: Ref<string>) {
  const snapshot = ref<LabelOverrideSnapshot | null>(null);
  const loading = ref(false);
  const loadError = ref('');
  const notOverridable = ref('');
  const saving = ref(false);
  const writeForbidden = ref(false);
  const writeReadOnly = ref(false);
  /** After a stale revision or an unknown outcome, nothing is sent until the operator reloads. */
  const needsReload = ref(false);
  let loadGeneration = 0;

  const warnings = computed(() => snapshot.value?.warnings ?? []);
  const readOnly = computed(
    () => snapshot.value?.readOnlyReason != null || writeReadOnly.value || writeForbidden.value,
  );

  async function load() {
    const id = containerId.value;
    const generation = ++loadGeneration;
    if (snapshot.value?.containerId !== id) {
      snapshot.value = null;
      writeForbidden.value = false;
      writeReadOnly.value = false;
    }
    loading.value = true;
    loadError.value = '';
    notOverridable.value = '';
    try {
      const loaded = await getLabelOverrides(id);
      if (generation !== loadGeneration || id !== containerId.value) return;
      snapshot.value = loaded;
      needsReload.value = false;
    } catch (error: unknown) {
      if (generation !== loadGeneration || id !== containerId.value) return;
      snapshot.value = null;
      if (error instanceof LabelOverrideHttpError && error.status === 409) {
        notOverridable.value = error.message;
      } else {
        loadError.value = errorMessage(error, i18n.global.t('labelOverrides.errors.load'));
      }
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  async function write(
    run: (current: LabelOverrideSnapshot) => Promise<LabelOverrideWriteResult>,
  ): Promise<LabelOverrideOutcome | undefined> {
    const current = snapshot.value;
    if (current === null || saving.value || needsReload.value) return undefined;
    const id = containerId.value;
    saving.value = true;
    try {
      const result = await run(current);
      if (id !== containerId.value) return undefined;
      snapshot.value = result;
      return { ok: true, changed: result.changed };
    } catch (error: unknown) {
      if (id !== containerId.value) return undefined;
      const failure = failureFromError(error);
      if (failure.kind === 'forbidden') writeForbidden.value = true;
      if (failure.kind === 'readOnly') writeReadOnly.value = true;
      if (failure.kind === 'notOverridable') notOverridable.value = failure.message;
      if (failure.kind === 'conflict' || failure.kind === 'unknown') needsReload.value = true;
      return { ok: false, failure };
    } finally {
      saving.value = false;
    }
  }

  const patch = (
    current: LabelOverrideSnapshot,
    field: LabelOwnedField,
    value?: LabelOverrideValue,
  ) =>
    patchLabelOverrides(current.containerId, {
      revision: current.revision,
      overrideId: current.overrideId,
      changes: [value === undefined ? { field, op: 'remove' } : { field, op: 'set', value }],
    });

  return {
    snapshot,
    loading,
    loadError,
    notOverridable,
    saving,
    writeForbidden,
    needsReload,
    warnings,
    readOnly,
    load,
    saveField: (field: LabelOwnedField, value: LabelOverrideValue) =>
      write((current) => patch(current, field, value)),
    resetField: (field: LabelOwnedField) => write((current) => patch(current, field)),
    resetAll: () =>
      write((current) =>
        resetLabelOverrides(current.containerId, current.revision, current.overrideId),
      ),
  };
}

export {
  buildIconValue,
  failureFromError,
  fieldErrorCodes,
  ICON_PROVIDERS,
  type IconProvider,
  isEditableField,
  isValidIconSlug,
  LABEL_OVERRIDE_GROUPS,
  type LabelOverrideFailure,
  type LabelOverrideOutcome,
  parseIconValue,
  useLabelOverrides,
  validateDisplayNameDraft,
};
