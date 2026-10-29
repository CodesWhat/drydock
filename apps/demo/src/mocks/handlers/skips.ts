import { HttpResponse, http } from 'msw';
import { createTriggerSkipSeed } from '../data/skips';
import { triggers } from '../data/triggers';
import { errorResponse } from './errors';

const skips = createTriggerSkipSeed();
const DEFAULT_LIMIT = 50;

function positiveInt(value: string | null, fallback: number, min: number): number {
  const parsed = Number(value);
  return value !== null && Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

function createSkipsHandlers(basePath: string) {
  const respond = ({
    params,
    request,
  }: {
    params: Record<string, string | readonly string[] | undefined>;
    request: Request;
  }) => {
    const trigger = triggers.find((t) => t.type === params.type && t.name === params.name);
    if (!trigger) return errorResponse(404, 'Trigger not found');
    const url = new URL(request.url);
    const limit = positiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT, 1);
    const offset = positiveInt(url.searchParams.get('offset'), 0, 0);
    const all = skips[trigger.id] ?? [];
    const data = all.slice(offset, offset + limit);
    return HttpResponse.json({
      data,
      total: all.length,
      limit,
      offset,
      hasMore: offset + data.length < all.length,
    });
  };
  return [
    http.get(`${basePath}/:type/:name/skips`, respond),
    http.get(`${basePath}/:type/:name/:agent/skips`, respond),
  ];
}

export const skipsHandlers = [
  ...createSkipsHandlers('/api/v1/actions'),
  ...createSkipsHandlers('/api/v1/notification-triggers'),
];
