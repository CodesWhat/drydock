// @ts-nocheck
import logger from '../log/index.js';
const log = logger.child({ component: 'store' });
import * as container from './container.js';
const { getContainers, deleteContainer } = container;

/**
 * Delete all containers from state.
 */
function deleteAllContainersFromState() {
    log.info('Incompatible state found; reset');
    getContainers({}).forEach((container) => deleteContainer(container.id));
}

/**
 * Data migration function.
 * @param from version
 * @param to version
 */
export function migrate(from, to) {
    const safeFrom = String(from).replaceAll(/[^a-zA-Z0-9._\-+]/g, '');
    const safeTo = String(to).replaceAll(/[^a-zA-Z0-9._\-+]/g, '');
    log.info(`Migrate data from version ${safeFrom} to version ${safeTo}`);
    if (from && !from.startsWith('8') && to && to.startsWith('8')) {
        deleteAllContainersFromState();
    }
}
