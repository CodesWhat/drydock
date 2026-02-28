// @ts-nocheck
/**
 * Container store.
 */
import { byString, byValues } from 'sort-es';
import * as container from '../model/container.js';

const { validate: validateContainer } = container;

import { emitContainerAdded, emitContainerRemoved, emitContainerUpdated } from '../event/index.js';
import { initCollection } from './util.js';

let containers;

// Security state cache: keyed by "{watcher}_{name}" to survive container recreation
const securityStateCache = new Map();

export function cacheSecurityState(watcher, name, security) {
  securityStateCache.set(`${watcher}_${name}`, security);
}

export function getCachedSecurityState(watcher, name) {
  return securityStateCache.get(`${watcher}_${name}`);
}

export function clearCachedSecurityState(watcher, name) {
  securityStateCache.delete(`${watcher}_${name}`);
}

function getUpdateDetectedAt(containerCurrent, containerNext) {
  if (!containerNext.updateAvailable) {
    return undefined;
  }

  if (
    typeof containerNext.updateDetectedAt === 'string' &&
    containerNext.updateDetectedAt.length > 0
  ) {
    return containerNext.updateDetectedAt;
  }

  if (!containerCurrent) {
    return new Date().toISOString();
  }

  const updateChanged =
    typeof containerCurrent.resultChanged === 'function' &&
    containerCurrent.resultChanged(containerNext);

  if (!containerCurrent.updateAvailable || updateChanged) {
    return new Date().toISOString();
  }

  if (
    typeof containerCurrent.updateDetectedAt === 'string' &&
    containerCurrent.updateDetectedAt.length > 0
  ) {
    return containerCurrent.updateDetectedAt;
  }

  return new Date().toISOString();
}

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
  const cachedSecurity = getCachedSecurityState(container.watcher, container.name);
  if (cachedSecurity && !container.security) {
    container.security = cachedSecurity;
    clearCachedSecurityState(container.watcher, container.name);
  }
  const containerToSave = validateContainer(container);
  containerToSave.updateDetectedAt = getUpdateDetectedAt(undefined, containerToSave);
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
  const hasUpdatePolicy = Object.hasOwn(container, 'updatePolicy');
  const hasSecurity = Object.hasOwn(container, 'security');
  const containerCurrentDoc =
    typeof containers?.findOne === 'function'
      ? containers.findOne({ 'data.id': container.id })
      : undefined;
  const containerCurrent = containerCurrentDoc
    ? validateContainer(containerCurrentDoc.data)
    : undefined;
  const containerMerged = {
    ...container,
    updatePolicy: hasUpdatePolicy ? container.updatePolicy : containerCurrent?.updatePolicy,
    security: hasSecurity ? container.security : containerCurrent?.security,
  };
  const containerToReturn = validateContainer(containerMerged);
  containerToReturn.updateDetectedAt = getUpdateDetectedAt(containerCurrent, containerToReturn);

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
  const containerList = containers.find(filter).map((item) => validateContainer(item.data));
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
