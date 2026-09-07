import { configFileInterpolatedKeys, configFileSources, ddEnvVars } from '../index.js';
import { type ConfigValueSource, mergeConfigLayers } from './sources.js';

/**
 * Pure "would this candidate file layer change anything" comparison, shared
 * by `POST /api/v1/config/validate` (roadmap 7.1 slice 5, `api/config-
 * validate.ts`) and `POST /api/v1/config/reload` (slice 6,
 * `configuration/file/reload.ts`). Extracted out of `api/config-validate.ts`
 * rather than having `reload.ts` import that route module directly, which
 * would be a `configuration/` → `api/` dependency running backwards against
 * every other file in this family.
 */

const DD_ENV_KEY_PREFIX = 'DD_';

// spec-7.1-config-file.md section 4.3's reload/restart table, section names
// only (the table's finer-grained rows — `server.webhook`, `server.tls`,
// ... — all share the `server` top segment `flattenConfigTree`/`get()`
// already collapse to, so the top segment is the right granularity here).
// Anything not in this set defaults to restart-required, matching the
// table's own "conservative direction" for a section it doesn't name.
export const RELOADABLE_SECTIONS = new Set(['watcher', 'registry', 'action', 'notification']);

export interface ConfigurationValidationDiff {
  /** `DD_*` keys whose effective value would change if this candidate
   * replaced the current file layer. */
  changed: string[];
  /** Section names among `changed` that reload without a restart. */
  reload: string[];
  /** Section names among `changed` that need a restart to take effect. */
  restart: string[];
}

export function emptyDiff(): ConfigurationValidationDiff {
  return { changed: [], reload: [], restart: [] };
}

/** The section a `DD_*` key belongs to — the first segment after the
 * prefix, lowercased. Mirrors `config.ts`'s own `ddEnvKeyToSegments`, one
 * level shallower: this only ever needs the top segment to classify a
 * changed key as reloadable or restart-required. */
export function ddEnvKeyToSection(envKey: string): string | undefined {
  const withoutPrefix = envKey.slice(DD_ENV_KEY_PREFIX.length);
  const [section] = withoutPrefix.split('_');
  return section ? section.toLowerCase() : undefined;
}

/**
 * Merge the candidate file layer beneath the real environment, the same way
 * startup does (`configuration/index.ts`'s step 3, `mergeConfigLayers`) —
 * env still wins — and compute which keys would change if this candidate
 * replaced the current file layer.
 *
 * `ddEnvVars` is already the merged (env-over-current-file) map, so
 * reconstructing "just the environment" first is what makes a *second*
 * merge, against a *different* file layer, precedence-correct: every key
 * `configFileSources` attributes to `'file'` is dropped before re-merging,
 * so the candidate's value for that key is free to win, while every key
 * attributed to `'env'` (or absent from `sources` — a Joi default) is left
 * exactly as `ddEnvVars` already has it, since the file was never able to
 * touch it either way. Neither `ddEnvVars` nor `configFileSources` is
 * mutated — every operation below is against a fresh copy.
 *
 * `envSourcedFileKeys` threads through to the final `mergeConfigLayers` call
 * exactly as it does at bootstrap (`decision D1`): a candidate key whose
 * value came from `${NAME}` interpolation attributes as `env` in the
 * returned `candidateSources` map, even though it physically arrived via the
 * candidate file layer. Callers that don't track per-key interpolation
 * (`config-validate.ts`'s ad-hoc YAML candidate) can omit it.
 */
export function buildCandidateEnvAndDiff(
  candidateFileLayer: Record<string, string>,
  envSourcedFileKeys?: ReadonlySet<string>,
): {
  candidateEnv: Record<string, string | undefined>;
  candidateSources: Record<string, ConfigValueSource>;
  diff: ConfigurationValidationDiff;
} {
  const envOnly: Record<string, string | undefined> = { ...ddEnvVars };
  const currentFileKeys = new Set<string>();
  for (const key of Object.keys(configFileSources)) {
    if (configFileSources[key] === 'file') {
      currentFileKeys.add(key);
      delete envOnly[key];
    }
  }
  // An interpolated key attributes as `'env'` in `configFileSources` (decision
  // D1, mirrored by `mergeConfigLayers`), even though its value physically
  // arrived via the file layer — so it belongs in `currentFileKeys` exactly
  // like a literal `'file'`-sourced key does, or a reload would never see it
  // as changed or removed (`configFileInterpolatedKeys`'s own doc comment on
  // `../index.ts`).
  for (const key of configFileInterpolatedKeys) {
    currentFileKeys.add(key);
    delete envOnly[key];
  }

  const changedKeys = new Set<string>();
  const candidateKeys = Object.keys(candidateFileLayer);
  for (const key of new Set([...currentFileKeys, ...candidateKeys])) {
    if (configFileSources[key] === 'env' && !configFileInterpolatedKeys.has(key)) {
      // Env always wins; the candidate file can never change this key's
      // effective value, whatever it sets. A key that's `'env'`-attributed
      // only because it's currently interpolated is NOT skipped here: its
      // resolved value can still change (a different `${NAME}` reference, or
      // the same one pointed at a different real env var), and the file can
      // still remove it outright — both are real changes this loop has to
      // see.
      continue;
    }
    const currentValue = currentFileKeys.has(key) ? ddEnvVars[key] : undefined;
    const candidateValue = candidateFileLayer[key];
    if (currentValue !== candidateValue) {
      changedKeys.add(key);
    }
  }

  const candidateEnv: Record<string, string | undefined> = { ...envOnly };
  const candidateSources = mergeConfigLayers(candidateEnv, candidateFileLayer, envSourcedFileKeys);

  const reload = new Set<string>();
  const restart = new Set<string>();
  for (const key of changedKeys) {
    const section = ddEnvKeyToSection(key);
    if (!section) {
      continue;
    }
    if (RELOADABLE_SECTIONS.has(section)) {
      reload.add(section);
    } else {
      restart.add(section);
    }
  }

  return {
    candidateEnv,
    candidateSources,
    diff: {
      changed: Array.from(changedKeys).sort(),
      reload: Array.from(reload).sort(),
      restart: Array.from(restart).sort(),
    },
  };
}
