import { HttpResponse, http } from 'msw';
import { createApiKeySeed, type DemoApiKey } from '../data/apiKeys';
import { confirmationMissing, errorResponse } from './errors';
import { readJsonRecord } from './json';

const keys = createApiKeySeed();
const SCOPES = new Set([
  'read',
  'containers:watch',
  'containers:update',
  'triggers:test',
  'admin',
  'api-keys:manage',
]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PREFIX_LENGTH = 12;
let counter = 0;

function newestFirst(): DemoApiKey[] {
  return [...keys].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Children first is not needed here: demo keys never mint children. */
function revokeCascade(keyId: string): string[] {
  const key = keys.find((candidate) => candidate.keyId === keyId);
  if (!key || key.status === 'revoked') return [];
  key.status = 'revoked';
  key.revokedAt = new Date().toISOString();
  key.revokedBy = 'demo';
  const children = keys.filter((candidate) => candidate.parentKeyId === keyId);
  return [keyId, ...children.flatMap((child) => revokeCascade(child.keyId))];
}

export const apiKeyHandlers = [
  http.get('/api/v1/api-keys', ({ request }) => {
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get('limit'));
    const limit =
      Number.isInteger(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const sorted = newestFirst();
    const cursor = url.searchParams.get('cursor');
    const start = cursor === null ? 0 : sorted.findIndex((key) => key.keyId === cursor) + 1;
    if (cursor !== null && start === 0) return errorResponse(400, 'Invalid cursor');
    const remaining = sorted.slice(start);
    const data = remaining.slice(0, limit);
    const hasMore = remaining.length > limit;
    return HttpResponse.json({
      data,
      total: sorted.length,
      limit,
      ...(hasMore ? { nextCursor: data[data.length - 1].keyId } : {}),
    });
  }),

  http.post('/api/v1/api-keys', async ({ request }) => {
    const body = await readJsonRecord(request);
    if (!body) return errorResponse(400, 'Request body must be a JSON object');
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return errorResponse(400, 'name must be a non-empty string');
    }
    if (
      !Array.isArray(body.scopes) ||
      body.scopes.length === 0 ||
      !body.scopes.every((scope) => typeof scope === 'string' && SCOPES.has(scope))
    ) {
      return errorResponse(400, `scopes must be a non-empty array of: ${[...SCOPES].join(', ')}`);
    }
    if (
      body.rateLimitMax !== undefined &&
      (typeof body.rateLimitMax !== 'number' || body.rateLimitMax < 1)
    ) {
      return errorResponse(400, 'rateLimitMax must be a positive number');
    }
    counter += 1;
    const apiKey = `dd_demo_${String(counter).padStart(4, '0')}_not_a_real_key`;
    const record: DemoApiKey = {
      keyId: `demo-key-new-${counter}`,
      name: body.name.trim(),
      displayPrefix: apiKey.slice(0, PREFIX_LENGTH),
      scopes: body.scopes as string[],
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: 'demo',
      parentKeyId: null,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      lastUsedAt: null,
      revokedAt: null,
      ...(typeof body.rateLimitMax === 'number' ? { rateLimitMax: body.rateLimitMax } : {}),
    };
    keys.push(record);
    return HttpResponse.json({ ...record, apiKey }, { status: 201 });
  }),

  http.delete('/api/v1/api-keys/:keyId', ({ params, request }) => {
    if (confirmationMissing(request, 'api-key-revoke')) {
      return errorResponse(428, 'Confirmation required: X-DD-Confirm-Action=api-key-revoke');
    }
    const keyId = String(params.keyId);
    if (!keys.some((key) => key.keyId === keyId)) return errorResponse(404, 'API key not found');
    const revokedKeyIds = revokeCascade(keyId);
    return HttpResponse.json({ keyId, revokedKeyIds, cascadeCount: revokedKeyIds.length });
  }),
];
