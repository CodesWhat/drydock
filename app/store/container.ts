// @ts-nocheck
/**
 * Container store.
 */
import { byString, byValues } from 'sort-es';
import * as container from '../model/container.js';
const { validate: validateContainer } = container;
import {
    emitContainerAdded,
    emitContainerUpdated,
    emitContainerRemoved,
} from '../event/index.js';
import { initCollection } from './util.js';

let containers;

/**
 * Create container collections.
 * @param db
 */
export function createCollections(db) {
    containers = initCollection(db, 'containers');
}

/**
 * Insert new Container.
 * @param container
 */
export function insertContainer(container) {
    const containerToSave = validateContainer(container);
    containers.insert({
        data: containerToSave,
    });
    emitContainerAdded(containerToSave);
    return containerToSave;
}

/**
 * Update existing container.
 * @param container
 */
export function updateContainer(container) {
    const hasUpdatePolicy = Object.prototype.hasOwnProperty.call(
        container,
        'updatePolicy',
    );
    const containerCurrentDoc =
        typeof containers?.findOne === 'function'
            ? containers.findOne({ 'data.id': container.id })
            : undefined;
    const containerCurrent = containerCurrentDoc
        ? validateContainer(containerCurrentDoc.data)
        : undefined;
    const containerMerged = {
        ...container,
        updatePolicy:
            hasUpdatePolicy ? container.updatePolicy : containerCurrent?.updatePolicy,
    };
    const containerToReturn = validateContainer(containerMerged);

    // Remove existing container
    containers
        .chain()
        .find({
            'data.id': container.id,
        })
        .remove();

    // Insert new one
    containers.insert({
        data: containerToReturn,
    });
    emitContainerUpdated(containerToReturn);
    return containerToReturn;
}

/**
 * Get all (filtered) containers.
 * @param query
 * @returns {*}
 */
export function getContainers(query = {}) {
    const filter = {};
    Object.keys(query).forEach((key) => {
        filter[`data.${key}`] = query[key];
    });
    if (!containers) {
        return [];
    }
    const containerList = containers
        .find(filter)
        .map((item) => validateContainer(item.data));
    return containerList.sort(
        byValues([
            [(container) => container.watcher, byString()],
            [(container) => container.name, byString()],
            [(container) => container.image.tag.value, byString()],
        ]),
    );
}

/**
 * Get container by id.
 * @param id
 * @returns {null|Image}
 */
export function getContainer(id) {
    const container = containers.findOne({
        'data.id': id,
    });

    if (container !== null) {
        return validateContainer(container.data);
    }
    return undefined;
}

/**
 * Delete container by id.
 * @param id
 */
export function deleteContainer(id) {
    const container = getContainer(id);
    if (container) {
        containers
            .chain()
            .find({
                'data.id': id,
            })
            .remove();
        emitContainerRemoved(container);
    }
}
