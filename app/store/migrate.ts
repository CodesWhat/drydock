import logger from '../log/index.js';

const log = logger.child({ component: 'store' });

/**
 * Data migration function.
 * @param from version
 * @param to version
 */
export function migrate(_from, _to) {
  log.info('Migrate data between schema versions');
}
