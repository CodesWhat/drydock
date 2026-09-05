import {
  ApprovalApiError,
  type ApprovalRecord,
  approveApproval,
  deferApproval,
  getApproval,
  getApprovalSummary,
  listApprovals,
  rejectApproval,
} from '@/services/approval';

function makeApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schemaVersion: 1,
    id: 'approval-1',
    containerId: 'container-1',
    containerIdentityKey: 'docker.local/app',
    containerName: 'app',
    watcher: 'local',
    image: 'ghcr.io/example/app',
    fromRef: '1.0.0',
    toRef: '1.1.0',
    candidateRef: '1.1.0',
    updateKind: 'tag',
    semverDiff: 'minor',
    createdAt: '2026-08-29T09:00:00.000Z',
    createdAtMs: 1_756_461_600_000,
    decision: 'pending',
    ...overrides,
  };
}

describe('approval service', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listApprovals', () => {
    it('fetches /api/v1/approvals with no query string when called with no args', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ data: [], total: 0, limit: 0, offset: 0, hasMore: false }),
      });

      await listApprovals();

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/approvals', { credentials: 'include' });
    });

    it('builds the query string from every filter', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [makeApproval()],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        }),
      });

      const result = await listApprovals({
        status: 'deferred',
        containerId: 'container-1',
        agent: 'edge-1',
        semverDiff: 'major',
        q: 'app',
        limit: 50,
        offset: 10,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/approvals?status=deferred&containerId=container-1&agent=edge-1&semverDiff=major&q=app&limit=50&offset=10',
        { credentials: 'include' },
      );
      expect(result.data).toEqual([makeApproval()]);
    });

    it('throws ApprovalApiError with the body error message on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Invalid status query parameter' }),
      });

      const err = await listApprovals().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApprovalApiError);
      expect((err as ApprovalApiError).message).toBe('Invalid status query parameter');
      expect((err as ApprovalApiError).statusCode).toBe(400);
    });

    it('falls back to statusText when the error body cannot be parsed', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      });

      const err = await listApprovals().catch((e: unknown) => e);
      expect((err as ApprovalApiError).message).toBe(
        'Failed to load approvals: Internal Server Error',
      );
    });
  });

  describe('getApprovalSummary', () => {
    it('fetches /api/v1/approvals/summary', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ pending: 3, deferred: 1, decidedToday: 2 }),
      });

      const result = await getApprovalSummary();

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/approvals/summary', {
        credentials: 'include',
      });
      expect(result).toEqual({ pending: 3, deferred: 1, decidedToday: 2 });
    });

    it('throws ApprovalApiError on !ok', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(getApprovalSummary()).rejects.toThrow(
        'Failed to load approval summary: Unauthorized',
      );
    });
  });

  describe('getApproval', () => {
    it('fetches /api/v1/approvals/:id and URL-encodes the id', async () => {
      const approval = makeApproval();
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ approval, holdReasons: [] }),
      });

      const result = await getApproval('approval/1');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/approvals/approval%2F1', {
        credentials: 'include',
      });
      expect(result.approval).toEqual(approval);
    });

    it('throws ApprovalApiError on 404', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ error: 'Approval not found' }),
      });

      const err = await getApproval('missing').catch((e: unknown) => e);
      expect((err as ApprovalApiError).statusCode).toBe(404);
      expect((err as ApprovalApiError).message).toBe('Approval not found');
    });
  });

  describe('approveApproval', () => {
    it('POSTs to /api/v1/approvals/:id/approve with an empty body by default', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({ operationId: 'op-1' }),
      });

      const result = await approveApproval('approval-1');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/approvals/approval-1/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(result).toEqual({ operationId: 'op-1' });
    });

    it('includes the note in the body when given', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ operationId: 'op-2' }),
      });

      await approveApproval('approval-1', { note: 'looks safe' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/approvals/approval-1/approve',
        expect.objectContaining({ body: JSON.stringify({ note: 'looks safe' }) }),
      );
    });

    it('throws ApprovalApiError with the notify-mode message on 409', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: vi.fn().mockResolvedValue({ error: 'Update mode is notify; approve is disabled' }),
      });

      const err = await approveApproval('approval-1').catch((e: unknown) => e);
      expect((err as ApprovalApiError).statusCode).toBe(409);
      expect((err as ApprovalApiError).message).toBe('Update mode is notify; approve is disabled');
    });
  });

  describe('rejectApproval', () => {
    it('POSTs to /api/v1/approvals/:id/reject', async () => {
      const approval = makeApproval({ decision: 'rejected' });
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ approval }),
      });

      const result = await rejectApproval('approval-1', { note: 'not needed' });

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/approvals/approval-1/reject', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'not needed' }),
      });
      expect(result.approval).toEqual(approval);
    });

    it('throws ApprovalApiError on failure', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: vi.fn().mockResolvedValue({ error: 'Approval already decided' }),
      });

      await expect(rejectApproval('approval-1')).rejects.toThrow('Approval already decided');
    });
  });

  describe('deferApproval', () => {
    it('POSTs an empty body when no options are given', async () => {
      const approval = makeApproval({ decision: 'deferred' });
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ approval }),
      });

      await deferApproval('approval-1');

      expect(global.fetch).toHaveBeenCalledWith('/api/v1/approvals/approval-1/defer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    });

    it('includes days, until and note when given', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ approval: makeApproval({ decision: 'deferred' }) }),
      });

      await deferApproval('approval-1', {
        until: '2026-09-10T00:00:00.000Z',
        days: 14,
        note: 'waiting on QA',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/approvals/approval-1/defer',
        expect.objectContaining({
          body: JSON.stringify({
            until: '2026-09-10T00:00:00.000Z',
            days: 14,
            note: 'waiting on QA',
          }),
        }),
      );
    });

    it('throws ApprovalApiError on invalid day count', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Invalid days' }),
      });

      await expect(deferApproval('approval-1', { days: 0 })).rejects.toThrow('Invalid days');
    });
  });
});
