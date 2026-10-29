import { HttpResponse, http } from 'msw';
import type { ApiContainerUpdateOperation } from '@/types/api';
import { containers } from '../data/containers';
import { dependencyEdges } from '../data/dependencies';
import { confirmationMissing, errorResponse } from './errors';
import { readJsonRecord } from './json';

type DemoContainer = (typeof containers)[number];

const BULK_MAX_IDS = 200;
const OPERATOR_CANCELLED = 'Cancelled by operator';
const QUEUED_MS = 1_000;
const IN_PROGRESS_MS = 4_000;

interface StoredOperation {
  id: string;
  containerId: string;
  containerName: string;
  fromVersion: string;
  toVersion: string;
  createdAtMs: number;
  cancelledAtMs?: number;
}

const operations = new Map<string, StoredOperation>();
let operationCounter = 0;

function findContainer(id: string | readonly string[] | undefined): DemoContainer | undefined {
  return containers.find((container) => container.id === id);
}

function startOperation(container: DemoContainer): string {
  operationCounter += 1;
  const id = `demo-op-${container.name}-${operationCounter}`;
  operations.set(id, {
    id,
    containerId: container.id,
    containerName: container.name,
    fromVersion: container.image.tag.value,
    toVersion: container.result?.tag ?? container.image.tag.value,
    createdAtMs: Date.now(),
  });
  return id;
}

function viewOperation(op: StoredOperation): ApiContainerUpdateOperation {
  const base = {
    id: op.id,
    kind: 'container-update' as const,
    containerId: op.containerId,
    containerName: op.containerName,
    fromVersion: op.fromVersion,
    toVersion: op.toVersion,
    createdAt: new Date(op.createdAtMs).toISOString(),
  };
  if (op.cancelledAtMs !== undefined) {
    const at = new Date(op.cancelledAtMs).toISOString();
    return {
      ...base,
      status: 'rolled-back',
      phase: 'rolled-back',
      rollbackReason: 'cancelled',
      lastError: OPERATOR_CANCELLED,
      updatedAt: at,
      completedAt: at,
    };
  }
  const age = Date.now() - op.createdAtMs;
  if (age < QUEUED_MS) {
    return { ...base, status: 'queued', phase: 'queued', updatedAt: base.createdAt };
  }
  if (age < IN_PROGRESS_MS) {
    return {
      ...base,
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: new Date(op.createdAtMs + QUEUED_MS).toISOString(),
    };
  }
  const done = new Date(op.createdAtMs + IN_PROGRESS_MS).toISOString();
  return { ...base, status: 'succeeded', phase: 'succeeded', updatedAt: done, completedAt: done };
}

/** Ids minted by the older single-container handlers (`demo-update-<id>`, `demo-op-...`). */
function synthesizeFinishedOperation(id: string): ApiContainerUpdateOperation | undefined {
  if (!id.startsWith('demo-')) return undefined;
  const at = new Date().toISOString();
  return {
    id,
    kind: 'container-update',
    status: 'succeeded',
    phase: 'succeeded',
    createdAt: at,
    updatedAt: at,
    completedAt: at,
  };
}

function hasUpdate(container: DemoContainer): boolean {
  return Boolean(container.updateAvailable && container.result?.tag);
}

function buildGraph() {
  const byName = new Map(containers.map((container) => [container.name, container]));
  const edges = dependencyEdges.flatMap((edge) => {
    const from = byName.get(edge.from);
    const to = byName.get(edge.to);
    return from && to
      ? [{ from: from.id, to: to.id, action: edge.action, source: edge.source }]
      : [];
  });
  return { edges };
}

function connectedComponent(rootId: string): Set<string> {
  const { edges } = buildGraph();
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      for (const [near, far] of [
        [edge.from, edge.to],
        [edge.to, edge.from],
      ]) {
        if (near === current && !seen.has(far)) {
          seen.add(far);
          queue.push(far);
        }
      }
    }
  }
  return seen;
}

function buildWaves(rootId: string) {
  const { edges } = buildGraph();
  const members = [...connectedComponent(rootId)];
  const waveOf = new Map<string, number>();
  const resolve = (id: string, trail: Set<string>): number => {
    const known = waveOf.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0;
    trail.add(id);
    const dependencies = edges.filter((edge) => edge.from === id).map((edge) => edge.to);
    const wave = dependencies.length
      ? 1 + Math.max(...dependencies.map((dep) => resolve(dep, trail)))
      : 0;
    waveOf.set(id, wave);
    return wave;
  };
  for (const id of members) resolve(id, new Set());
  const actionKind = (id: string): 'update' | 'restart' => {
    const outgoing = edges.filter((edge) => edge.from === id);
    return outgoing.length > 0 && outgoing.every((edge) => edge.action === 'restart')
      ? 'restart'
      : 'update';
  };
  const waveCount = Math.max(...waveOf.values()) + 1;
  return Array.from({ length: waveCount }, (_, index) => ({
    index,
    containers: members
      .filter((id) => waveOf.get(id) === index)
      .map((id) => {
        const container = findContainer(id);
        return { id, name: container?.name ?? id, actionKind: actionKind(id) };
      }),
  }));
}

function bumpPatch(tag: string): string {
  const match = /^(v?)(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match ? `${match[1]}${match[2]}.${match[3]}.${Number(match[4]) + 1}` : tag;
}

export const containerOpsHandlers = [
  http.post('/api/v1/containers/update', async ({ request }) => {
    const body = await readJsonRecord(request);
    const ids = body?.containerIds;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > BULK_MAX_IDS ||
      !ids.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return errorResponse(
        400,
        `Invalid containerIds; expected a non-empty array of at most ${BULK_MAX_IDS} container ids`,
      );
    }
    const accepted: Array<{ containerId: string; containerName: string; operationId: string }> = [];
    const rejected: Array<{
      containerId: string;
      containerName: string;
      statusCode: number;
      message: string;
    }> = [];
    for (const id of new Set(ids as string[])) {
      const container = findContainer(id);
      if (!container) {
        rejected.push({
          containerId: id,
          containerName: id,
          statusCode: 404,
          message: 'Container not found',
        });
      } else if (!hasUpdate(container)) {
        rejected.push({
          containerId: id,
          containerName: container.name,
          statusCode: 409,
          message: 'No update available',
        });
      } else {
        accepted.push({
          containerId: id,
          containerName: container.name,
          operationId: startOperation(container),
        });
      }
    }
    return HttpResponse.json({
      message: 'Container update requests processed',
      accepted,
      rejected,
    });
  }),

  http.get('/api/v1/update-operations/:id', ({ params }) => {
    const id = String(params.id);
    const stored = operations.get(id);
    const view = stored ? viewOperation(stored) : synthesizeFinishedOperation(id);
    if (!view) return errorResponse(404, 'Operation not found');
    return HttpResponse.json(view);
  }),

  http.post('/api/v1/operations/:id/cancel', ({ params }) => {
    const stored = operations.get(String(params.id));
    if (!stored) {
      const synthetic = synthesizeFinishedOperation(String(params.id));
      if (!synthetic) return errorResponse(404, 'Operation not found');
      return errorResponse(409, 'Operation is not active', { status: synthetic.status });
    }
    const current = viewOperation(stored);
    if (current.status !== 'queued' && current.status !== 'in-progress') {
      return errorResponse(409, 'Operation is not active', { status: current.status });
    }
    stored.cancelledAtMs = Date.now();
    return HttpResponse.json(
      { data: viewOperation(stored) },
      { status: current.status === 'queued' ? 200 : 202 },
    );
  }),

  http.get('/api/v1/containers/dependencies', () =>
    HttpResponse.json({
      nodes: containers.map((container) => ({
        id: container.id,
        name: container.name,
        displayName: container.displayName,
        watcher: container.watcher,
      })),
      edges: buildGraph().edges,
      cycles: [],
      unresolved: [],
      crossHostIgnored: [],
    }),
  ),

  http.post('/api/v1/containers/:id/update-chain-preview', ({ params }) => {
    if (!findContainer(params.id)) return errorResponse(404, 'Container not found');
    return HttpResponse.json({
      waves: buildWaves(String(params.id)),
      warnings: { cycles: [], unresolved: [] },
    });
  }),

  http.post('/api/v1/dependency-groups/:rootId/update', async ({ params, request }) => {
    if (confirmationMissing(request, 'dependency-group-update')) {
      return errorResponse(
        428,
        'Confirmation required: X-DD-Confirm-Action=dependency-group-update',
      );
    }
    const rootId = String(params.rootId);
    if (!findContainer(rootId)) return errorResponse(404, 'Container not found');
    const body = await readJsonRecord(request);
    const expected = body?.expectedContainerIds;
    if (
      expected !== undefined &&
      (!Array.isArray(expected) || !expected.every((id) => typeof id === 'string'))
    ) {
      return errorResponse(400, 'Invalid expectedContainerIds; expected an array of container ids');
    }
    const waves = buildWaves(rootId);
    const chainIds = waves.flatMap((wave) => wave.containers.map((entry) => entry.id));
    if (
      Array.isArray(expected) &&
      (expected.length !== chainIds.length || !chainIds.every((id) => expected.includes(id)))
    ) {
      return errorResponse(409, 'The dependency chain changed since it was previewed');
    }
    const accepted: Array<Record<string, unknown>> = [];
    const rejected: Array<Record<string, unknown>> = [];
    for (const wave of waves) {
      for (const entry of wave.containers) {
        const container = findContainer(entry.id);
        if (container && (entry.actionKind === 'restart' || hasUpdate(container))) {
          accepted.push({
            containerId: entry.id,
            containerName: entry.name,
            operationId: startOperation(container),
            wave: wave.index,
            actionKind: entry.actionKind,
          });
        } else {
          rejected.push({
            containerId: entry.id,
            containerName: entry.name,
            statusCode: 409,
            message: 'No update available',
          });
        }
      }
    }
    return HttpResponse.json({
      message: 'Dependency group update requests processed',
      accepted,
      rejected,
    });
  }),

  http.post('/api/v1/containers/scan-all', async ({ request }) => {
    const body = await readJsonRecord(request);
    const requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;
    return HttpResponse.json({
      cycleId: `demo-scan-${Date.now()}`,
      scheduledCount: containers.filter((container) => container.status === 'running').length,
      ...(requestId ? { requestId } : {}),
    });
  }),

  http.get('/api/v1/containers/:id/intermediate-release-notes', ({ params, request }) => {
    const container = findContainer(params.id);
    if (!container) return errorResponse(404, 'Container not found');
    const url = new URL(request.url);
    const from = url.searchParams.get('from')?.trim() ?? '';
    if (from === '') return errorResponse(400, "Query parameter 'from' is required");
    const to = url.searchParams.get('to')?.trim() || container.result?.tag || '';
    if (to === '') {
      return errorResponse(
        422,
        "Cannot determine target tag: provide 'to' or ensure the container has a pending update",
      );
    }
    const tags = [...new Set([bumpPatch(from), to])].filter((tag) => tag !== from);
    return HttpResponse.json({
      releaseNotes: tags.map((tag, index) => ({
        title: `${container.displayName} ${tag}`,
        body: `Demo release notes for ${container.displayName}\n\n- Changes since ${from}`,
        url: `https://github.com/CodesWhat/drydock/releases/tag/v${tag}`,
        publishedAt: new Date(Date.now() - (tags.length - index) * 86_400_000).toISOString(),
        provider: 'github',
      })),
      hiddenCount: 0,
    });
  }),
];
