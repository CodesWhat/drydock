import { HttpResponse, http } from 'msw';
import { errorResponse } from './errors';
import { readJsonRecord } from './json';

const PREFERENCES_API_VERSION = 1;
const username = 'demo';

const stored: {
  schemaVersion: number | null;
  preferences: Record<string, unknown> | null;
  updatedAt: string | null;
} = { schemaVersion: null, preferences: null, updatedAt: null };

function envelope() {
  return { apiVersion: PREFERENCES_API_VERSION, username, ...structuredClone(stored) };
}

export const preferencesHandlers = [
  http.get('/api/v1/preferences', () => HttpResponse.json(envelope())),

  http.patch('/api/v1/preferences', async ({ request }) => {
    const body = (await readJsonRecord(request)) ?? {};
    if (body.apiVersion !== PREFERENCES_API_VERSION) {
      return HttpResponse.json(
        { error: 'PREFERENCES_API_VERSION_MISMATCH', supportedApiVersion: PREFERENCES_API_VERSION },
        { status: 409 },
      );
    }
    const { schemaVersion, preferences } = body;
    if (
      typeof schemaVersion !== 'number' ||
      !Number.isInteger(schemaVersion) ||
      schemaVersion < 1
    ) {
      return errorResponse(400, '"schemaVersion" must be an integer greater than or equal to 1');
    }
    if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
      return errorResponse(400, '"preferences" must be an object');
    }
    stored.schemaVersion = schemaVersion;
    stored.preferences = structuredClone(preferences) as Record<string, unknown>;
    stored.updatedAt = new Date().toISOString();
    return HttpResponse.json(envelope());
  }),
];
