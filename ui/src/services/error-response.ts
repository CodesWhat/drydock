export async function readHttpError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => ({ error: 'Unknown error' }));
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string' &&
    body.error.trim()
  ) {
    return body.error;
  }
  return `HTTP ${response.status}`;
}
