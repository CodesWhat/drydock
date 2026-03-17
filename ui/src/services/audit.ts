import { extractCollectionData } from '../utils/api';

export async function getAuditLog(
  params: {
    page?: number;
    offset?: number;
    limit?: number;
    action?: string;
    container?: string;
    from?: string;
    to?: string;
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
  if (params.action) query.set('action', params.action);
  if (params.container) query.set('container', params.container);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
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
