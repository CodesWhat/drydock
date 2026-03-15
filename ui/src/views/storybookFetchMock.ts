function parseRequestPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return raw.startsWith('http') ? new URL(raw).pathname : raw;
}

function createJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installJsonPathMock(path: string, data: unknown): void {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const requestPath = parseRequestPath(input);
    if (requestPath === path) {
      return createJsonResponse(data, 200);
    }

    return createJsonResponse({ error: `No mock for ${requestPath}` }, 404);
  };
}
