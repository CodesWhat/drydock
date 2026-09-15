import type { Request, Response } from 'express';
import yaml from 'yaml';
import {
  buildCandidateEnvAndDiff,
  type ConfigurationValidationDiff,
  emptyDiff,
} from '../configuration/file/diff.js';
import { flattenConfigTree } from '../configuration/file/flatten.js';
import { interpolateConfigTree } from '../configuration/file/interpolate.js';
import {
  type ConfigurationValidationResult,
  validateConfiguration,
} from '../configuration/file/validate.js';
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

interface ValidateConfigurationResponse {
  valid: boolean;
  errors: ConfigurationValidationResult['errors'];
  diff: ConfigurationValidationDiff;
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
