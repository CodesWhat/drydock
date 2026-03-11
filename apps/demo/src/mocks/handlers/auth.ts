import { HttpResponse, http } from 'msw';

const demoUser = { username: 'demo', displayName: 'Demo User' };

/**
 * Simulate a brief "server offline" period after logout so the login page
 * shows the "Connection Lost" overlay for a few seconds before recovering.
 * Each browser tab tracks its own logout timestamp (module-level state is
 * per service-worker client in MSW), giving every user an independent
 * experience.
 */
const OFFLINE_DURATION_MS = 5_000;
let offlineUntil = 0;

function isOffline(): boolean {
  return Date.now() < offlineUntil;
}

export const authHandlers = [
  http.get('/auth/user', () => {
    if (isOffline()) {
      return new HttpResponse(null, { status: 401 });
    }
    return HttpResponse.json(demoUser);
  }),

  http.get('/auth/strategies', () => {
    if (isOffline()) {
      return HttpResponse.error();
    }
    return HttpResponse.json([{ type: 'basic', name: 'basic' }]);
  }),

  http.post('/auth/login', () => HttpResponse.json(demoUser)),

  http.post('/auth/logout', () => {
    offlineUntil = Date.now() + OFFLINE_DURATION_MS;
    return HttpResponse.json({ success: true });
  }),

  http.post('/auth/remember', () => HttpResponse.json({ success: true })),

  http.get('/auth/oidc/:name/redirect', () => HttpResponse.json({ redirectUrl: '/' })),
];
