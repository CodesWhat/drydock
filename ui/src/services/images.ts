import { extractCollectionData, readJsonResponse } from '../utils/api';
import { ApiError } from '../utils/error';

const IMAGES_API_BASE = '/api/v1/images';

export type PruneMode = 'dangling' | 'unused';

export interface ImageInventoryItem {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  size: number;
  reclaimable: number;
  created: string;
  containers: number;
  dangling: boolean;
  watcher: string;
  agent?: string;
  lastSeen?: string;
}

export interface ImageHostSummary {
  id: string;
  name: string;
  agent?: string;
  supported: boolean;
  reason?: 'agent-transport-unsupported';
  error?: string;
}

export interface ImagesResponse {
  images: ImageInventoryItem[];
  hosts: ImageHostSummary[];
}

export interface PruneEstimate {
  host: string;
  mode: PruneMode;
  images: number;
  reclaimable: number;
}

export interface ImagePruneResult {
  host: string;
  mode: PruneMode;
  imagesDeleted: number;
  spaceReclaimed: number;
}

interface ActionResultEnvelope<T> {
  message: string;
  result: T;
}

interface ImagesListEnvelope {
  data?: unknown;
  total?: number;
  hosts?: ImageHostSummary[];
}

type ErrorEnvelope = { error?: unknown };

function messageFromErrorEnvelope(body: ErrorEnvelope, fallback: string): string {
  return typeof body.error === 'string' && body.error.trim() ? body.error : fallback;
}

async function readErrorEnvelope(response: Response, context: string): Promise<ErrorEnvelope> {
  try {
    return await readJsonResponse<ErrorEnvelope>(response, context);
  } catch {
    return {};
  }
}

async function throwForResponse(
  response: Response,
  context: string,
  fallback: string,
): Promise<never> {
  const body = await readErrorEnvelope(response, context);
  throw new ApiError(messageFromErrorEnvelope(body, fallback), response.status);
}

export async function getImages(params: { host?: string } = {}): Promise<ImagesResponse> {
  const query = new URLSearchParams();
  if (params.host) {
    query.set('host', params.host);
  }
  const queryString = query.toString();
  const response = await fetch(`${IMAGES_API_BASE}${queryString ? `?${queryString}` : ''}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    await throwForResponse(response, 'Images API', `Failed to load images: ${response.statusText}`);
  }
  const payload = await readJsonResponse<ImagesListEnvelope>(response, 'Images API');
  return {
    images: extractCollectionData<ImageInventoryItem>(payload),
    hosts: payload.hosts ?? [],
  };
}

export async function getPrunePreview(params: {
  host: string;
  mode: PruneMode;
}): Promise<PruneEstimate> {
  const query = new URLSearchParams({ host: params.host, mode: params.mode });
  const response = await fetch(`${IMAGES_API_BASE}/prune-preview?${query.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    await throwForResponse(
      response,
      'Image prune preview API',
      `Failed to load prune preview: ${response.statusText}`,
    );
  }
  return readJsonResponse<PruneEstimate>(response, 'Image prune preview API');
}

export async function pruneImages(params: {
  host: string;
  mode: PruneMode;
}): Promise<ImagePruneResult> {
  const response = await fetch(`${IMAGES_API_BASE}/prune`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-DD-Confirm-Action': 'image-prune',
    },
    body: JSON.stringify({ host: params.host, mode: params.mode }),
  });
  if (!response.ok) {
    await throwForResponse(
      response,
      'Image prune API',
      `Failed to prune images: ${response.statusText}`,
    );
  }
  const payload = await readJsonResponse<ActionResultEnvelope<ImagePruneResult>>(
    response,
    'Image prune API',
  );
  return payload.result;
}
