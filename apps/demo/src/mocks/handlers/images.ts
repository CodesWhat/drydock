import { HttpResponse, http } from 'msw';
import type { ImageInventoryItem, PruneMode } from '@/services/images';
import { createImageInventory, imageHosts } from '../data/images';
import { readJsonRecord } from './json';

const inventory = createImageInventory();

function error(status: number, message: string) {
  return HttpResponse.json({ error: message }, { status });
}

function isPruneMode(value: unknown): value is PruneMode {
  return value === 'dangling' || value === 'unused';
}

function pruneCandidates(host: string, mode: PruneMode): ImageInventoryItem[] {
  if (host !== 'docker.local') return [];
  return inventory.filter(
    (image) => image.containers === 0 && (mode === 'unused' || image.dangling),
  );
}

function resolveHost(hostId: string) {
  const host = imageHosts.find((candidate) => candidate.id === hostId);
  if (!host) return { response: error(404, 'Image host not found') };
  if (!host.supported) {
    return { response: error(501, 'Image inventory is not available for this host') };
  }
  return { host };
}

export const imageHandlers = [
  http.get('/api/v1/images', ({ request }) => {
    const hostId = new URL(request.url).searchParams.get('host');
    if (hostId) {
      const resolved = resolveHost(hostId);
      if (resolved.response) return resolved.response;
    }
    const data = hostId && hostId !== 'docker.local' ? [] : inventory;
    return HttpResponse.json({ data, total: data.length, hosts: imageHosts });
  }),

  http.get('/api/v1/images/prune-preview', ({ request }) => {
    const params = new URL(request.url).searchParams;
    const host = params.get('host');
    const mode = params.get('mode');
    if (!host) return error(400, 'host is required');
    if (!isPruneMode(mode)) return error(400, 'mode must be "dangling" or "unused"');
    const resolved = resolveHost(host);
    if (resolved.response) return resolved.response;
    const candidates = pruneCandidates(host, mode);
    return HttpResponse.json({
      host,
      mode,
      images: candidates.length,
      reclaimable: candidates.reduce((sum, image) => sum + image.reclaimable, 0),
    });
  }),

  http.post('/api/v1/images/prune', async ({ request }) => {
    const body = await readJsonRecord(request);
    if (!body) return error(400, 'Invalid request body; expected a JSON object');
    if (typeof body.host !== 'string' || body.host.length === 0) {
      return error(400, 'host is required');
    }
    if (!isPruneMode(body.mode)) return error(400, 'mode must be "dangling" or "unused"');
    const resolved = resolveHost(body.host);
    if (resolved.response) return resolved.response;

    const candidates = pruneCandidates(body.host, body.mode);
    const removed = new Set(candidates);
    for (let index = inventory.length - 1; index >= 0; index -= 1) {
      if (removed.has(inventory[index])) inventory.splice(index, 1);
    }
    return HttpResponse.json({
      message: 'Image prune completed',
      result: {
        host: body.host,
        mode: body.mode,
        imagesDeleted: candidates.length,
        spaceReclaimed: candidates.reduce((sum, image) => sum + image.reclaimable, 0),
      },
    });
  }),
];
