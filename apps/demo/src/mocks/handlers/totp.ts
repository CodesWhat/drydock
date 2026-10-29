import { HttpResponse, http } from 'msw';
import { errorResponse } from './errors';
import { readJsonRecord } from './json';

const ENROLLMENT_TTL_MS = 10 * 60_000;
const RECOVERY_CODE_COUNT = 8;
const demoUser = { username: 'demo', displayName: 'Demo User' };

interface Enrollment {
  id: string;
  secret: string;
  expiresAt: string;
  replacesFactor: boolean;
}

const factor: {
  active: boolean;
  activatedAt?: string;
  recoveryCodes: string[];
  pending?: Enrollment;
} = { active: false, recoveryCodes: [] };
let enrollmentCounter = 0;
let codeSetCounter = 0;

function reauthFailure() {
  return errorResponse(401, 'Re-authentication failed', { details: { reason: 'reauth-failed' } });
}

/** Password always, plus one proof once a factor is active. The demo accepts any well-formed value. */
async function checkReauth(request: Request): Promise<Response | undefined> {
  const body = await readJsonRecord(request);
  if (!body || typeof body.password !== 'string' || body.password === '') {
    return errorResponse(400, 'password is required');
  }
  if (factor.active) {
    const code = typeof body.code === 'string' && /^\d{6}$/.test(body.code);
    const recovery = typeof body.recoveryCode === 'string' && body.recoveryCode !== '';
    if (!code && !recovery) return reauthFailure();
  }
  return undefined;
}

function newRecoveryCodes(): string[] {
  codeSetCounter += 1;
  return Array.from(
    { length: RECOVERY_CODE_COUNT },
    (_, index) =>
      `demo-${String(codeSetCounter).padStart(2, '0')}${String(index).padStart(2, '0')}-0000`,
  );
}

function pendingView(enrollment: Enrollment) {
  return {
    id: enrollment.id,
    expiresAt: enrollment.expiresAt,
    replacesFactor: enrollment.replacesFactor,
  };
}

export const totpHandlers = [
  http.get('/api/v1/auth/totp-factor', () => {
    if (factor.pending && Date.parse(factor.pending.expiresAt) < Date.now())
      factor.pending = undefined;
    return HttpResponse.json({
      status: factor.active ? 'active' : 'unenrolled',
      ...(factor.active ? { activatedAt: factor.activatedAt } : {}),
      recoveryCodesRemaining: factor.recoveryCodes.length,
      ...(factor.pending ? { pendingEnrollment: pendingView(factor.pending) } : {}),
    });
  }),

  http.post('/api/v1/auth/totp-enrollments', async ({ request }) => {
    const failure = await checkReauth(request);
    if (failure) return failure;
    enrollmentCounter += 1;
    // Obviously fake seed: the demo never verifies codes against it.
    const secret = 'DEMOONLYNOTAREALSEED';
    factor.pending = {
      id: `demo-enrollment-${enrollmentCounter}`,
      secret,
      expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS).toISOString(),
      replacesFactor: factor.active,
    };
    return HttpResponse.json(
      {
        ...pendingView(factor.pending),
        secret,
        otpauthUri: `otpauth://totp/Drydock%20Demo:demo?secret=${secret}&issuer=Drydock%20Demo`,
      },
      { status: 201 },
    );
  }),

  http.put('/api/v1/auth/totp-enrollments/:id', async ({ params, request }) => {
    if (!factor.pending || factor.pending.id !== params.id) {
      return errorResponse(404, 'Enrollment not found');
    }
    const body = await readJsonRecord(request);
    if (!body || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
      return errorResponse(401, 'Invalid code', { details: { reason: 'invalid-code' } });
    }
    factor.active = true;
    factor.activatedAt = new Date().toISOString();
    factor.recoveryCodes = newRecoveryCodes();
    factor.pending = undefined;
    return HttpResponse.json({ recoveryCodes: [...factor.recoveryCodes] });
  }),

  http.delete('/api/v1/auth/totp-enrollments/:id', ({ params }) => {
    if (factor.pending?.id === params.id) factor.pending = undefined;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/auth/totp-recovery-code-sets', async ({ request }) => {
    const failure = await checkReauth(request);
    if (failure) return failure;
    if (!factor.active) {
      return errorResponse(409, 'Two-factor is not enabled', {
        details: { reason: 'not-enrolled' },
      });
    }
    factor.recoveryCodes = newRecoveryCodes();
    return HttpResponse.json({ recoveryCodes: [...factor.recoveryCodes] }, { status: 201 });
  }),

  http.delete('/api/v1/auth/totp-factor', async ({ request }) => {
    const failure = await checkReauth(request);
    if (failure) return failure;
    factor.active = false;
    factor.activatedAt = undefined;
    factor.recoveryCodes = [];
    return new HttpResponse(null, { status: 204 });
  }),

  http.put('/auth/login-challenges/:id', () => HttpResponse.json(demoUser)),

  http.delete('/auth/login-challenges/:id', () => new HttpResponse(null, { status: 204 })),

  http.post('/auth/api-key-review/acknowledge', () => new HttpResponse(null, { status: 204 })),
];
