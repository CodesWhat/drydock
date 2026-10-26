import { HttpResponse, http } from 'msw';
import type { ApprovalRecord, ApprovalStatusFilter } from '@/services/approval';
import { daysToMs } from '../../utils/time';
import { createApprovalSeed } from '../data/approvals';
import { readJsonRecord } from './json';

const approvals = createApprovalSeed();

const DEFER_MAX_DAYS = 90;
const BULK_MAX_IDS = 200;
const NOTE_MAX_LENGTH = 1000;
const BULK_ACTIONS = new Set(['approve', 'reject']);
const decidedBy = 'demo';

type DecisionBody = Record<string, unknown>;

function error(status: number, message: string) {
  return HttpResponse.json({ error: message }, { status });
}

function matchesStatus(record: ApprovalRecord, status: ApprovalStatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'decided') return record.decision === 'approved' || record.decision === 'rejected';
  return record.decision === status;
}

function startOfTodayMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function countApprovals() {
  const today = startOfTodayMs();
  return {
    pending: approvals.filter((a) => a.decision === 'pending').length,
    deferred: approvals.filter((a) => a.decision === 'deferred').length,
    decidedToday: approvals.filter(
      (a) =>
        a.decision !== 'pending' && a.decidedAt !== undefined && Date.parse(a.decidedAt) >= today,
    ).length,
  };
}

function parseNote(body: DecisionBody): { note?: string } | { error: string } {
  if (body.note === undefined) return {};
  if (typeof body.note !== 'string' || body.note.length > NOTE_MAX_LENGTH) {
    return { error: `Invalid note; expected a string of at most ${NOTE_MAX_LENGTH} characters` };
  }
  return { note: body.note };
}

function parseDeferral(body: DecisionBody): { deferredUntil: string } | { error: string } {
  if (body.until !== undefined && body.days !== undefined) {
    return { error: 'Provide either until or days, not both' };
  }
  if (body.until !== undefined) {
    const until = typeof body.until === 'string' ? Date.parse(body.until) : Number.NaN;
    const now = Date.now();
    if (!Number.isFinite(until) || until <= now || until > now + daysToMs(DEFER_MAX_DAYS)) {
      return {
        error: `Invalid until; expected an RFC 3339 date-time in the future, at most ${DEFER_MAX_DAYS} days from now`,
      };
    }
    return { deferredUntil: new Date(until).toISOString() };
  }
  const days = body.days === undefined ? 7 : body.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > DEFER_MAX_DAYS) {
    return { error: `Invalid days; expected an integer between 1 and ${DEFER_MAX_DAYS}` };
  }
  return { deferredUntil: new Date(Date.now() + daysToMs(days)).toISOString() };
}

type Decision = 'approved' | 'rejected' | 'deferred';
type DecideResult = { record: ApprovalRecord } | { statusCode: number; message: string };

function decide(
  id: string,
  decision: Decision,
  note: string | undefined,
  deferredUntil?: string,
): DecideResult {
  const record = approvals.find((a) => a.id === id);
  if (!record) return { statusCode: 404, message: 'Approval not found' };
  if (record.decision !== 'pending') {
    return { statusCode: 409, message: 'Approval already decided' };
  }
  record.decision = decision;
  record.decidedAt = new Date().toISOString();
  record.decidedBy = decidedBy;
  if (note !== undefined) record.decisionNote = note;
  if (deferredUntil !== undefined) record.deferredUntil = deferredUntil;
  if (decision === 'approved') {
    record.operationId = `demo-op-${record.containerName}-${Date.now()}`;
  }
  return { record };
}

async function readDecisionBody(request: Request): Promise<DecisionBody | undefined> {
  return readJsonRecord(request);
}

export const approvalHandlers = [
  http.get('/api/v1/approvals', ({ request }) => {
    const url = new URL(request.url);
    const status = (url.searchParams.get('status') ?? 'pending') as ApprovalStatusFilter;
    const containerId = url.searchParams.get('containerId');
    const semverDiff = url.searchParams.get('semverDiff');
    const q = url.searchParams.get('q')?.toLowerCase();
    const limitParam = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : 50;
    const offsetParam = Number(url.searchParams.get('offset'));
    const offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;

    const filtered = approvals
      .filter((a) => matchesStatus(a, status))
      .filter((a) => !containerId || a.containerId === containerId)
      .filter((a) => !semverDiff || a.semverDiff === semverDiff)
      .filter((a) => !q || `${a.containerName} ${a.image} ${a.toRef}`.toLowerCase().includes(q))
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
    const data = filtered.slice(offset, offset + limit);

    return HttpResponse.json({
      data,
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + data.length < filtered.length,
    });
  }),

  http.get('/api/v1/approvals/summary', () => HttpResponse.json(countApprovals())),

  http.post('/api/v1/approvals/bulk', async ({ request }) => {
    if (request.headers.get('x-dd-confirm-action')?.toLowerCase() !== 'approvals-bulk-approve') {
      return error(428, 'Confirmation required: X-DD-Confirm-Action=approvals-bulk-approve');
    }
    const body = await readDecisionBody(request);
    if (!body) return error(400, 'Invalid request body; expected a JSON object');

    const ids = body.ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > BULK_MAX_IDS ||
      !ids.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return error(
        400,
        `Invalid ids; expected a non-empty array of at most ${BULK_MAX_IDS} approval ids`,
      );
    }
    if (typeof body.action !== 'string' || !BULK_ACTIONS.has(body.action)) {
      return error(400, 'Invalid action; expected approve or reject');
    }
    const parsedNote = parseNote(body);
    if ('error' in parsedNote) return error(400, parsedNote.error);

    const decision: Decision = body.action === 'approve' ? 'approved' : 'rejected';
    const accepted: Array<Record<string, unknown>> = [];
    const rejected: Array<{ id: string; statusCode: number; message: string }> = [];
    for (const id of new Set(ids as string[])) {
      const result = decide(id, decision, parsedNote.note);
      if (!('record' in result)) {
        rejected.push({ id, statusCode: result.statusCode, message: result.message });
        continue;
      }
      accepted.push({
        id,
        containerId: result.record.containerId,
        containerName: result.record.containerName,
        decision: result.record.decision,
        ...(result.record.operationId ? { operationId: result.record.operationId } : {}),
      });
    }
    return HttpResponse.json({ message: 'Approval decisions processed', accepted, rejected });
  }),

  http.get('/api/v1/approvals/:id', ({ params }) => {
    const approval = approvals.find((a) => a.id === params.id);
    if (!approval) return error(404, 'Approval not found');
    return HttpResponse.json({ approval, holdReasons: [] });
  }),

  http.post('/api/v1/approvals/:id/approve', async ({ params, request }) => {
    const body = await readDecisionBody(request);
    if (!body) return error(400, 'Invalid request body; expected a JSON object');
    const parsedNote = parseNote(body);
    if ('error' in parsedNote) return error(400, parsedNote.error);
    const result = decide(String(params.id), 'approved', parsedNote.note);
    if (!('record' in result)) return error(result.statusCode, result.message);
    return HttpResponse.json({
      operationId: result.record.operationId,
      message: 'Update accepted',
    });
  }),

  http.post('/api/v1/approvals/:id/reject', async ({ params, request }) => {
    const body = await readDecisionBody(request);
    if (!body) return error(400, 'Invalid request body; expected a JSON object');
    const parsedNote = parseNote(body);
    if ('error' in parsedNote) return error(400, parsedNote.error);
    const result = decide(String(params.id), 'rejected', parsedNote.note);
    if (!('record' in result)) return error(result.statusCode, result.message);
    return HttpResponse.json({ approval: result.record });
  }),

  http.post('/api/v1/approvals/:id/defer', async ({ params, request }) => {
    const body = await readDecisionBody(request);
    if (!body) return error(400, 'Invalid request body; expected a JSON object');
    const parsedNote = parseNote(body);
    if ('error' in parsedNote) return error(400, parsedNote.error);
    const deferral = parseDeferral(body);
    if ('error' in deferral) return error(400, deferral.error);
    const result = decide(String(params.id), 'deferred', parsedNote.note, deferral.deferredUntil);
    if (!('record' in result)) return error(result.statusCode, result.message);
    return HttpResponse.json({ approval: result.record });
  }),
];
