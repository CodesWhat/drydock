function extractCollectionData<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload && typeof payload === 'object') {
    if (Array.isArray((payload as { data?: unknown }).data)) {
      return (payload as { data: T[] }).data;
    }

    if (Array.isArray((payload as { items?: unknown }).items)) {
      return (payload as { items: T[] }).items;
    }
  }

  return [];
}

export { extractCollectionData };
