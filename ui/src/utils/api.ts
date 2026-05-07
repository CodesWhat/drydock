type CollectionEnvelope = { data?: unknown; items?: unknown; entries?: unknown };
type ItemValidator<T> = (item: unknown) => item is T;

function isJsonContentType(contentType: string): boolean {
  return /(^|[/+])json($|[;\s])/i.test(contentType);
}

function isHtmlResponse(contentType: string, bodyPreview: string): boolean {
  return (
    /\bhtml\b/i.test(contentType) ||
    /^\s*<!doctype\s+html/i.test(bodyPreview) ||
    /^\s*<html[\s>]/i.test(bodyPreview)
  );
}

async function readResponsePreview(response: Response): Promise<string> {
  try {
    if (typeof response.clone === 'function') {
      return (await response.clone().text()).slice(0, 120);
    }
    if (!response.bodyUsed && typeof response.text === 'function') {
      return (await response.text()).slice(0, 120);
    }
  } catch {
    // Best-effort context only. The normalized error below is still clearer than a JSON parse error.
  }
  return '';
}

async function readJsonResponse<T = unknown>(response: Response, context = 'API'): Promise<T> {
  const contentType = response.headers?.get('content-type')?.trim() ?? '';
  if (contentType && !isJsonContentType(contentType)) {
    const preview = await readResponsePreview(response);
    if (isHtmlResponse(contentType, preview)) {
      throw new Error(
        `${context} returned HTML instead of JSON. Check that the API server or demo mocks are running.`,
      );
    }
    throw new Error(`${context} returned ${contentType} instead of JSON.`);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${context} returned invalid JSON.`);
    }
    throw error;
  }
}

function extractCollectionData(payload: unknown): unknown[];
function extractCollectionData<T>(payload: unknown): T[];
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
    } else if (Array.isArray(envelope.entries)) {
      collection = envelope.entries;
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

export { extractCollectionData, readJsonResponse };
