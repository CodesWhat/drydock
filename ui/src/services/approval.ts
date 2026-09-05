import type { UpdateEligibility } from '../types/container';
import { readJsonResponse } from '../utils/api';

const APPROVALS_API_BASE = '/api/v1/approvals';

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'deferred';
export type ApprovalResolution =
  | 'superseded'
  | 'container-removed'
  | 'candidate-withdrawn'
  | 'auto-applied';
export type ApprovalOutcome = 'applied' | 'rolled-back' | 'failed';
export type ApprovalUpdateKind = 'tag' | 'digest' | 'unknown';
export type ApprovalSemverDiff = 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';
export type ApprovalStatusFilter = 'pending' | 'deferred' | 'decided' | 'all';

export interface ApprovalRecord {
  schemaVersion: number;
  id: string;
  containerId: string;
  containerIdentityKey: string;
  containerName: string;
  watcher: string;
  agent?: string;
  image: string;
  fromRef: string;
  toRef: string;
  candidateRef: string;
  updateKind: ApprovalUpdateKind;
  semverDiff: ApprovalSemverDiff;
  releaseNotesUrl?: string;
  scanCritical?: number;
  scanHigh?: number;
  scanMedium?: number;
  scanLow?: number;
  scanUnknown?: number;
  scanAt?: string;
  createdAt: string;
  createdAtMs: number;
  decision: ApprovalDecision;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  deferredUntil?: string;
  operationId?: string;
  outcome?: ApprovalOutcome;
  resolvedAt?: string;
  resolution?: ApprovalResolution;
}

export interface ApprovalListQuery {
  status?: ApprovalStatusFilter;
  containerId?: string;
  agent?: string;
  semverDiff?: ApprovalSemverDiff;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ApprovalListResponse {
  data: ApprovalRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ApprovalSummary {
  pending: number;
  deferred: number;
  decidedToday: number;
}

export interface ApprovalHoldReason {
  reason: string;
  severity?: 'hard' | 'soft';
  message: string;
  actionable: boolean;
  actionHint?: string;
  liftableAt?: string;
  details?: Record<string, unknown>;
}

export interface ApprovalDetailResponse {
  approval: ApprovalRecord;
  eligibility?: UpdateEligibility;
  holdReasons: ApprovalHoldReason[];
}

export interface ApprovalDecisionResponse {
  approval: ApprovalRecord;
}

export interface ApprovalUpdateAcceptedResponse {
  operationId?: string;
  message?: string;
}

export class ApprovalApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
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
  throw new ApprovalApiError(messageFromErrorEnvelope(body, fallback), response.status);
}

function buildQueryString(query: ApprovalListQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.containerId) params.set('containerId', query.containerId);
  if (query.agent) params.set('agent', query.agent);
  if (query.semverDiff) params.set('semverDiff', query.semverDiff);
  if (query.q) params.set('q', query.q);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function listApprovals(query: ApprovalListQuery = {}): Promise<ApprovalListResponse> {
  const response = await fetch(`${APPROVALS_API_BASE}${buildQueryString(query)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    await throwForResponse(
      response,
      'Approvals API',
      `Failed to load approvals: ${response.statusText}`,
    );
  }
  return readJsonResponse<ApprovalListResponse>(response, 'Approvals API');
}

async function getApprovalSummary(): Promise<ApprovalSummary> {
  const response = await fetch(`${APPROVALS_API_BASE}/summary`, { credentials: 'include' });
  if (!response.ok) {
    await throwForResponse(
      response,
      'Approvals summary API',
      `Failed to load approval summary: ${response.statusText}`,
    );
  }
  return readJsonResponse<ApprovalSummary>(response, 'Approvals summary API');
}

async function getApproval(id: string): Promise<ApprovalDetailResponse> {
  const response = await fetch(`${APPROVALS_API_BASE}/${encodeURIComponent(id)}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    await throwForResponse(
      response,
      'Approval detail API',
      `Failed to load approval: ${response.statusText}`,
    );
  }
  return readJsonResponse<ApprovalDetailResponse>(response, 'Approval detail API');
}

async function postDecision<T>(
  id: string,
  action: 'approve' | 'reject' | 'defer',
  body: Record<string, unknown> | undefined,
  context: string,
  fallback: string,
): Promise<T> {
  const response = await fetch(`${APPROVALS_API_BASE}/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    await throwForResponse(response, context, fallback);
  }
  return readJsonResponse<T>(response, context);
}

async function approveApproval(
  id: string,
  options: { note?: string } = {},
): Promise<ApprovalUpdateAcceptedResponse> {
  return postDecision<ApprovalUpdateAcceptedResponse>(
    id,
    'approve',
    options.note !== undefined ? { note: options.note } : undefined,
    'Approve approval API',
    'Failed to approve update',
  );
}

async function rejectApproval(
  id: string,
  options: { note?: string } = {},
): Promise<ApprovalDecisionResponse> {
  return postDecision<ApprovalDecisionResponse>(
    id,
    'reject',
    options.note !== undefined ? { note: options.note } : undefined,
    'Reject approval API',
    'Failed to reject update',
  );
}

async function deferApproval(
  id: string,
  options: { until?: string; days?: number; note?: string } = {},
): Promise<ApprovalDecisionResponse> {
  const body: Record<string, unknown> = {};
  if (options.until !== undefined) body.until = options.until;
  if (options.days !== undefined) body.days = options.days;
  if (options.note !== undefined) body.note = options.note;
  return postDecision<ApprovalDecisionResponse>(
    id,
    'defer',
    Object.keys(body).length > 0 ? body : undefined,
    'Defer approval API',
    'Failed to defer update',
  );
}

export {
  approveApproval,
  deferApproval,
  getApproval,
  getApprovalSummary,
  listApprovals,
  rejectApproval,
};
