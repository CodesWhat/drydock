export async function getAuditLog(
  params: {
    page?: number;
    limit?: number;
    action?: string;
    container?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.action) query.set('action', params.action);
  if (params.container) query.set('container', params.container);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const queryString = query.toString();
  const url = queryString ? `/api/audit?${queryString}` : '/api/audit';
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to fetch audit log: ${response.statusText}`);
  return response.json();
}

export function getAuditIcon() {
  return 'sh-clock-rotate-left';
}
