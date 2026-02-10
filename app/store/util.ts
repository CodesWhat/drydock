// @ts-nocheck
import logger from '../log/index.js';
const log = logger.child({ component: 'store' });

/**
 * Get or create a LokiJS collection by name.
 */
export function initCollection(db, name) {
    let collection = db.getCollection(name);
    if (collection === null) {
        log.info(`Create Collection ${name}`);
        collection = db.addCollection(name);
    }
    return collection;
}
