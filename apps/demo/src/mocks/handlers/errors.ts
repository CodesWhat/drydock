import { HttpResponse } from 'msw';

export function errorResponse(
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return HttpResponse.json({ error: message, ...extra }, { status });
}

export function confirmationMissing(request: Request, action: string): boolean {
  return request.headers.get('x-dd-confirm-action')?.toLowerCase() !== action;
}
