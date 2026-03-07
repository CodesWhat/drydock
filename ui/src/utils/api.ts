import { z } from 'zod';

const collectionItemSchema = z.object({}).catchall(z.unknown());
const collectionSchema = z.array(collectionItemSchema);

function extractCollectionData<T>(payload: unknown): T[] {
  let collection: unknown;

  if (Array.isArray(payload)) {
    collection = payload;
  } else if (payload && typeof payload === 'object') {
    const envelope = payload as { data?: unknown; items?: unknown };
    if (Array.isArray(envelope.data)) {
      collection = envelope.data;
    } else if (Array.isArray(envelope.items)) {
      collection = envelope.items;
    }
  }

  if (collection === undefined) {
    return [];
  }

  const parsedCollection = collectionSchema.safeParse(collection);
  if (!parsedCollection.success) {
    return [];
  }

  return parsedCollection.data as T[];
}

export { extractCollectionData };
