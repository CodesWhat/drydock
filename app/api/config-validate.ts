import type { Request, Response } from 'express';
import yaml from 'yaml';
import { flattenConfigTree } from '../configuration/file/flatten.js';
import { interpolateConfigTree } from '../configuration/file/interpolate.js';
import { mergeConfigLayers } from '../configuration/file/sources.js';
import {
  type ConfigurationValidationResult,
  validateConfiguration,
} from '../configuration/file/validate.js';
import { configFileSources, ddEnvVars } from '../configuration/index.js';
import { getErrorMessage } from '../util/error.js';
import { recordAuditEvent } from './audit-events.js';
import { sendErrorResponse } from './error-response.js';

/**
 * `POST /api/v1/config/validate` — validate a candidate `drydock.yml`
 * document against the real component schemas without applying it (roadmap
 * 7.1 slice 5, spec-7.1-config-file.md section 7). Reuses slice 1's
 * `flattenConfigTree`/`interpolateConfigTree` and slice 2's
 * `validateConfiguration` — the same functions the CLI's `config validate`
 * (slice 3) and real startup already call — rather than a second
 * implementation, so an invalid candidate is reported the same way
 * everywhere.
 *
 * Touches no disk and mutates no module state: `ddEnvVars` is only ever
 * read (spread into copies), never assigned to. `validateConfiguration`
 * itself substitutes and restores the singleton internally
 * (`file/validate.ts`'s `withCandidateEnv`), synchronously, so nothing here
 * needs to guard against that.
 *
 * `admin` scope, not `SESSION_ONLY`: unlike the two `GET` routes (an
 * environment reveal), this route never returns a configuration value —
 * only paths, env key names and error text — so an API key holding `admin`
 * is the right reach, matching `POST /api/v1/config/reload` (slice 6) and
 * `PUT /api/v1/config/:section` (slice 7), the other two routes that can
 * change what the running instance does (spec-7.1-config-file.md section
 * 4.1's route table).
 */

// Mirrors `CONFIG_FILE_MAX_ALIAS_COUNT` in `../configuration/file/loader.ts`.
// Duplicated rather than imported for the same reason `flatten.ts` and
// `interpolate.ts` already duplicate their own small constants: this keeps
// the candidate parse path free of `loader.ts`'s own fs-touching module
// (never called at import time either way, but there is no reason to widen
// this module's dependency surface for one number).
const CANDIDATE_MAX_ALIAS_COUNT = 100;

const DD_ENV_KEY_PREFIX = 'DD_';

// spec-7.1-config-file.md section 4.3's reload/restart table, section names
// only (the table's finer-grained rows — `server.webhook`, `server.tls`,
// ... — all share the `server` top segment `flattenConfigTree`/`get()`
// already collapse to, so the top segment is the right granularity here).
// Anything not in this set defaults to restart-required, matching the
// table's own "conservative direction" for a section it doesn't name.
const RELOADABLE_SECTIONS = new Set(['watcher', 'registry', 'action', 'notification']);

interface ConfigurationValidationDiff {
  /** `DD_*` keys whose effective value would change if this candidate
   * replaced the current file layer. */
  changed: string[];
  /** Section names among `changed` that reload without a restart. */
  reload: string[];
  /** Section names among `changed` that need a restart to take effect. */
  restart: string[];
}

interface ValidateConfigurationResponse {
  valid: boolean;
  errors: ConfigurationValidationResult['errors'];
  diff: ConfigurationValidationDiff;
}

function emptyDiff(): ConfigurationValidationDiff {
  return { changed: [], reload: [], restart: [] };
}

function singleDocumentError(message: string): ConfigurationValidationResult['errors'] {
  // No single YAML path or DD_* key exists yet at this stage — the failure
  // is about the document as a whole (bad syntax, a non-mapping root). This
  // sentinel mirrors validate.ts's own fallback for a whole-category
  // failure with no one instance to point at (its "trigger"/"trigger" pair
  // for a legacy-prefix rejection): `DD_CONFIG_FILE` is the real env var
  // that names a config file, so it is the closest DD_* key to "the
  // document itself" that exists.
  return [{ path: 'document', envKey: 'DD_CONFIG_FILE', message }];
}

type CandidateParseResult = { kind: 'ok'; tree: unknown } | { kind: 'error'; message: string };

/**
 * The request body is either `{ "yaml": "<document text>" }` (parsed with
 * the same hardening `loader.ts` applies to a real file: `uniqueKeys`,
 * `merge: false`, a pinned `maxAliasCount`) or the configuration tree
 * itself as a JSON object — the same shape `yaml.parse()` would have
 * produced. Both travel as `application/json`: the outer router's mutation
 * body parser (`express.json({ limit: '256kb' })`, `api.ts`) already
 * requires that content type and caps the size, and its `strict` default
 * only accepts an object or array as the top-level JSON value, which is why
 * a bare YAML string cannot be the whole body — it has to be wrapped in the
 * `yaml` field to survive that parse.
 */
function parseCandidateBody(body: unknown): CandidateParseResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      kind: 'error',
      message:
        'Request body must be a JSON object: either { "yaml": "<document text>" } ' +
        'or the configuration tree itself',
    };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.yaml === 'string') {
    try {
      const parsed = yaml.parse(record.yaml, {
        uniqueKeys: true,
        merge: false,
        maxAliasCount: CANDIDATE_MAX_ALIAS_COUNT,
      });
      return { kind: 'ok', tree: parsed };
    } catch (error) {
      return { kind: 'error', message: `not valid YAML: ${getErrorMessage(error)}` };
    }
  }

  return { kind: 'ok', tree: body };
}

/** The section a `DD_*` key belongs to — the first segment after the
 * prefix, lowercased. Mirrors `config.ts`'s own `ddEnvKeyToSegments`, one
 * level shallower: this only ever needs the top segment to classify a
 * changed key as reloadable or restart-required. */
function ddEnvKeyToSection(envKey: string): string | undefined {
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
 */
function buildCandidateEnvAndDiff(candidateFileLayer: Record<string, string>): {
  candidateEnv: Record<string, string | undefined>;
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

  const changedKeys = new Set<string>();
  const candidateKeys = Object.keys(candidateFileLayer);
  for (const key of new Set([...currentFileKeys, ...candidateKeys])) {
    if (configFileSources[key] === 'env') {
      // Env always wins; the candidate file can never change this key's
      // effective value, whatever it sets.
      continue;
    }
    const currentValue = currentFileKeys.has(key) ? ddEnvVars[key] : undefined;
    const candidateValue = candidateFileLayer[key];
    if (currentValue !== candidateValue) {
      changedKeys.add(key);
    }
  }

  const candidateEnv: Record<string, string | undefined> = { ...envOnly };
  mergeConfigLayers(candidateEnv, candidateFileLayer);

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
    diff: {
      changed: Array.from(changedKeys).sort(),
      reload: Array.from(reload).sort(),
      restart: Array.from(restart).sort(),
    },
  };
}

function respondWithResult(res: Response, response: ValidateConfigurationResponse): void {
  // Audited before the body is sent, matching config.ts's own read-route
  // ordering rationale: an audit failure has to become the 500 below,
  // never a body that already went out.
  recordAuditEvent({
    action: 'config-validated',
    containerName: 'diagnostics',
    status: 'info',
    details: response.valid
      ? 'Validated a candidate configuration: valid'
      : `Validated a candidate configuration: ${response.errors.length} error(s)`,
  });
  res.status(200).json(response);
}

export async function validateCandidateConfiguration(req: Request, res: Response): Promise<void> {
  try {
    const parsedBody = parseCandidateBody(req.body);
    if (parsedBody.kind === 'error') {
      respondWithResult(res, {
        valid: false,
        errors: singleDocumentError(parsedBody.message),
        diff: emptyDiff(),
      });
      return;
    }

    let interpolatedTree: unknown;
    try {
      interpolatedTree = interpolateConfigTree(parsedBody.tree, process.env).tree;
    } catch (error) {
      respondWithResult(res, {
        valid: false,
        errors: singleDocumentError(getErrorMessage(error)),
        diff: emptyDiff(),
      });
      return;
    }

    let candidateFileLayer: Record<string, string>;
    try {
      candidateFileLayer = flattenConfigTree(interpolatedTree);
    } catch (error) {
      respondWithResult(res, {
        valid: false,
        errors: singleDocumentError(getErrorMessage(error)),
        diff: emptyDiff(),
      });
      return;
    }

    const { candidateEnv, diff } = buildCandidateEnvAndDiff(candidateFileLayer);
    const result = await validateConfiguration(candidateEnv);

    respondWithResult(res, {
      valid: result.errors.length === 0,
      errors: result.errors,
      diff,
    });
  } catch {
    sendErrorResponse(res, 500, 'Unable to validate the candidate configuration');
  }
}
