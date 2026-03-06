import logger from '../log/index.js';

const log = logger.child({ component: 'store' });

/**
 * Data migration function.
 * @param from version
 * @param to version
 */
export function migrate(from, to) {
  const safeFrom = String(from).replaceAll(/[^a-zA-Z0-9._\-+]/g, '');
  const safeTo = String(to).replaceAll(/[^a-zA-Z0-9._\-+]/g, '');
  log.info(`Migrate data from version ${safeFrom} to version ${safeTo}`);
}
