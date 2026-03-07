type CollectionEnvelope = { data?: unknown; items?: unknown };
type ItemValidator<T> = (item: unknown) => item is T;

function extractCollectionData(payload: unknown): unknown[];
function extractCollectionData<T>(payload: unknown, validateItem: ItemValidator<T>): T[];
function extractCollectionData<T>(payload: unknown, validateItem?: ItemValidator<T>) {
  let collection: unknown[] | undefined;

  if (Array.isArray(payload)) {
    collection = payload;
  } else if (payload && typeof payload === 'object') {
    const envelope = payload as CollectionEnvelope;
    if (Array.isArray(envelope.data)) {
      collection = envelope.data;
    } else if (Array.isArray(envelope.items)) {
      collection = envelope.items;
    }
  }

  if (collection === undefined) {
    return [];
  }

  if (validateItem && !collection.every((item) => validateItem(item))) {
    return [];
  }

  return collection;
}

export { extractCollectionData };
