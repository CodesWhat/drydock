/**
 * Secrets store.
 */
import joi from 'joi';
import { initCollection } from './util.js';

interface SecretsDocument {
  sessionSecret?: string;
}

interface SecretsCollection {
  findOne(query: Record<string, unknown>): SecretsDocument | null;
  insert(document: SecretsDocument): void;
  remove(document: SecretsDocument): void;
}

interface SecretsStoreDb {
  getCollection(name: string): SecretsCollection | null;
  addCollection(name: string): SecretsCollection;
}

let secretsCollection: SecretsCollection | undefined;

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
 * @param db
 */
export function createCollections(db: SecretsStoreDb): void {
  secretsCollection = initCollection(db, 'secrets') as SecretsCollection;
}

/**
 * Get the stored session secret.
 * Returns null if not initialized or no value is stored.
 * @returns {string | null}
 */
export function getStoredSessionSecret(): string | null {
  if (!secretsCollection) {
    return null;
  }
  const doc = secretsCollection.findOne({});
  if (!doc || !doc.sessionSecret) {
    return null;
  }
  return doc.sessionSecret;
}

/**
 * Persist a session secret to the store.
 * Idempotent: removes any existing doc before inserting the new value.
 * @param value
 */
export function setStoredSessionSecret(value: string): void {
  if (!secretsCollection) {
    return;
  }
  const existing = secretsCollection.findOne({});
  if (existing) {
    secretsCollection.remove(existing);
  }
  const doc = validateSecretsDocument({ sessionSecret: value });
  secretsCollection.insert(doc);
}
