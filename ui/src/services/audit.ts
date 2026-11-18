import { extractCollectionData } from '../utils/api';

interface AuditFilterParams {
  action?: string;
  actions?: string[];
  container?: string;
  actor?: string;
  from?: string;
  to?: string;
}

function applyAuditFilters(query: URLSearchParams, params: AuditFilterParams) {
  if (params.action) query.set('action', params.action);
  if (params.actions && params.actions.length > 0) query.set('actions', params.actions.join(','));
  if (params.container) query.set('container', params.container);
  if (params.actor) query.set('actor', params.actor);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
}

export async function getAuditLog(
  params: AuditFilterParams & {
    page?: number;
    offset?: number;
    limit?: number;
  } = {},
) {
  const limit =
    typeof params.limit === 'number' && Number.isFinite(params.limit) ? params.limit : 50;
  const offset =
    typeof params.offset === 'number' && Number.isFinite(params.offset)
      ? params.offset
      : typeof params.page === 'number' && Number.isFinite(params.page)
        ? Math.max(0, (params.page - 1) * limit)
        : undefined;

  const query = new URLSearchParams();
  if (offset !== undefined) query.set('offset', String(offset));
  query.set('limit', String(limit));
  applyAuditFilters(query, params);
  const queryString = query.toString();
  const url = `/api/v1/audit?${queryString}`;
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to fetch audit log: ${response.statusText}`);
  const payload = await response.json();
  if (payload && typeof payload === 'object') {
    return {
      ...payload,
      entries: extractCollectionData(payload),
    };
  }
  return payload;
}

/**
 * Download every audit entry matching the filters as CSV or JSON. Returns the
 * file text and the name the server suggested, so the caller can save it.
 */
export async function exportAuditLog(
  format: 'csv' | 'json',
  params: AuditFilterParams = {},
): Promise<{ filename: string; text: string }> {
  const query = new URLSearchParams({ format });
  applyAuditFilters(query, params);
  const response = await fetch(`/api/v1/audit/export?${query.toString()}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`Failed to export audit log: ${response.statusText}`);
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `drydock-audit.${format}`;
  return { filename, text: await response.text() };
}
