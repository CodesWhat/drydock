/**
 * Secrets store.
 *
 * Backed by the `secrets` singleton table (roadmap 7-STORE, slice 3). The
 * collection importer at `app/store/db/importers/secrets.ts` carries the
 * session secret forward from an imported v1.7 `dd.json`, which is what keeps
 * everyone logged out only once across the upgrade rather than on every
 * restart.
 */
import joi from 'joi';
import type { Database } from './db/driver.js';

interface SecretsDocument {
  sessionSecret?: string;
}

let db: Database | undefined;

const secretsSchema = joi.object({
  sessionSecret: joi.string().min(1).optional(),
});

function validateSecretsDocument(doc: unknown): SecretsDocument {
  const result = secretsSchema.validate(doc, { stripUnknown: true });
  if (result.error) {
    throw result.error;
  }
  return result.value as SecretsDocument;
}

/**
 * Create secrets collection.
 * @param database
 */
export function createCollections(database: Database): void {
  db = database;
}

/**
 * Get the stored session secret.
 * Returns null if not initialized or no value is stored.
 * @returns {string | null}
 */
export function getStoredSessionSecret(): string | null {
  if (!db) {
    return null;
  }
  const row = db.prepare('SELECT session_secret FROM secrets WHERE id = 1').get();
  const value = row?.session_secret;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Persist a session secret to the store.
 * Idempotent: upserts the singleton row.
 * @param value
 */
export function setStoredSessionSecret(value: string): void {
  if (!db) {
    return;
  }
  const validated = validateSecretsDocument({ sessionSecret: value });
  db.prepare(
    `INSERT INTO secrets (id, session_secret) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET session_secret = excluded.session_secret`,
  ).run(validated.sessionSecret as string);
}
