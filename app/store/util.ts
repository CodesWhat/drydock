import logger from '../log/index.js';

const log = logger.child({ component: 'store' });

type CollectionIndexOptions = {
  indices?: string[] | string;
  binaryIndices?: string[] | string;
  [key: string]: unknown;
};

function addIndexNames(target: Set<string>, value: string[] | string | undefined): void {
  if (typeof value === 'string') {
    target.add(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((index) => target.add(index));
  }
}

function getAllIndexNames(options?: CollectionIndexOptions): string[] {
  const names = new Set<string>();
  addIndexNames(names, options?.indices);
  addIndexNames(names, options?.binaryIndices);
  return Array.from(names);
}

function normalizeCollectionOptions(
  options?: CollectionIndexOptions,
): CollectionIndexOptions | undefined {
  if (!options || options.binaryIndices === undefined) {
    return options;
  }

  // Loki's collection option for binary indexes is named "indices".
  return {
    ...options,
    indices: getAllIndexNames(options),
  };
}

/**
 * Get or create a LokiJS collection by name.
 */
export function initCollection(db, name, options: CollectionIndexOptions | undefined = undefined) {
  let collection = db.getCollection(name);
  if (collection === null) {
    log.info(`Create Collection ${name}`);
    const collectionOptions = normalizeCollectionOptions(options);
    collection = collectionOptions
      ? db.addCollection(name, collectionOptions)
      : db.addCollection(name);
  }

  const indices = getAllIndexNames(options);
  if (indices.length > 0 && typeof collection?.ensureIndex === 'function') {
    indices.forEach((index) => {
      collection.ensureIndex(index);
    });
  }

  return collection;
}
