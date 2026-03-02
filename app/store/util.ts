// @ts-nocheck
import logger from '../log/index.js';

const log = logger.child({ component: 'store' });

/**
 * Get or create a LokiJS collection by name.
 */
export function initCollection(db, name, options = undefined) {
  let collection = db.getCollection(name);
  if (collection === null) {
    log.info(`Create Collection ${name}`);
    collection = options ? db.addCollection(name, options) : db.addCollection(name);
  }

  const indices = options?.indices;
  if (Array.isArray(indices) && typeof collection?.ensureIndex === 'function') {
    indices.forEach((index) => {
      collection.ensureIndex(index);
    });
  }

  return collection;
}
