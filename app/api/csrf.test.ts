import { describe, expect, test, vi } from 'vitest';
import { requireSameOriginForMutations } from './csrf.js';

/**
 * Build a minimal mock Express Request.
 *
 * `protocol` should mirror what Express would expose after its own trust-proxy
 * resolution (i.e. already incorporates X-Forwarded-Proto when trust proxy is
 * enabled — just like the real Express `req.protocol` property).
 *
 * `trustProxy` maps to the value returned by `req.app.get('trust proxy')`.
 * falsy (default) → trust proxy disabled; truthy → trust proxy enabled.
 */
function createReq({
  method = 'GET',
  protocol = 'http',
  headers = {},
  trustProxy = false,
}: {
  method?: unknown;
  protocol?: string;
  headers?: Record<string, string | undefined>;
  trustProxy?: unknown;
} = {}) {
  return {
    method,
    protocol,
    app: { get: vi.fn((key: string) => (key === 'trust proxy' ? trustProxy : undefined)) },
    get: vi.fn((name: string) => headers[String(name).toLowerCase()]),
  };
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('CSRF middleware', () => {
  test('should skip CSRF validation for safe methods', () => {
    const req = createReq({ method: 'GET' });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('GET with cookies should skip CSRF validation (GET is in SAFE_METHODS)', () => {
    // If "GET" were replaced with "" in SAFE_METHODS, a GET request with cookies
    // would be treated as unsafe and fail the origin check.
    const req = createReq({
      method: 'GET',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        // no origin/referer — would be rejected if GET were treated as unsafe
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should skip CSRF validation for HEAD method', () => {
    const req = createReq({
      method: 'HEAD',
      headers: { cookie: 'connect.sid=s%3Atest' },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should skip CSRF validation for OPTIONS method', () => {
    const req = createReq({
      method: 'OPTIONS',
      headers: { cookie: 'connect.sid=s%3Atest' },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should skip CSRF validation for TRACE method', () => {
    const req = createReq({
      method: 'TRACE',
      headers: { cookie: 'connect.sid=s%3Atest' },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should treat DELETE as an unsafe method', () => {
    const req = createReq({
      method: 'DELETE',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should allow unsafe methods when origin matches request host', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should reject unsafe methods when Sec-Fetch-Site is cross-site', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'sec-fetch-site': 'cross-site',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should allow unsafe methods when Sec-Fetch-Site is same-site and origin matches request host', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'sec-fetch-site': 'same-site',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should not reject when Sec-Fetch-Site is same-origin', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'sec-fetch-site': 'same-origin',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should reject when Sec-Fetch-Site is CROSS-SITE (case-insensitive check)', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'sec-fetch-site': 'CROSS-SITE',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject when Sec-Fetch-Site has whitespace around cross-site', () => {
    // Tests that trim() is applied to sec-fetch-site before comparison
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'sec-fetch-site': '  cross-site  ',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should allow unsafe methods when forwarded proto indicates https behind reverse proxy (trust proxy ON)', () => {
    // Express sets req.protocol to 'https' when trust proxy is on and
    // X-Forwarded-Proto is 'https'; the middleware reads req.protocol directly.
    const req = createReq({
      method: 'POST',
      protocol: 'https', // what Express resolves from X-Forwarded-Proto when trust proxy is on
      trustProxy: true,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should accept protocol with trailing colon (https:) via req.protocol normalisation', () => {
    // parseProtocol strips the trailing colon so 'https:' is treated as 'https'.
    const req = createReq({
      method: 'POST',
      protocol: 'https:', // unlikely but parseProtocol handles it
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should normalize protocol to lowercase before comparison', () => {
    // parseProtocol lowercases req.protocol so 'HTTPS' is treated as 'https'.
    // If toLowerCase() were removed, 'HTTPS' would not equal 'https' and the
    // request would be rejected.
    const req = createReq({
      method: 'POST',
      protocol: 'HTTPS',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should accept protocol with trailing colon (http:) via req.protocol normalisation', () => {
    // parseProtocol strips a trailing colon from req.protocol.
    const req = createReq({
      method: 'POST',
      protocol: 'http:',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'http://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should reject when req.protocol is an unsupported scheme', () => {
    // parseProtocol returns undefined for anything other than http/https,
    // so expectedOrigin becomes undefined and the request is rejected.
    const req = createReq({
      method: 'POST',
      protocol: 'ftp',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'ftp://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should allow unsafe methods when forwarded host/proto match browser origin (trust proxy ON)', () => {
    // With trust proxy enabled, X-Forwarded-Host is used for the expected origin.
    // Express also sets req.protocol to 'https' from X-Forwarded-Proto.
    const req = createReq({
      method: 'POST',
      protocol: 'https', // Express-resolved from X-Forwarded-Proto
      trustProxy: true,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock:3000',
        origin: 'https://drydock.example.com',
        'x-forwarded-host': 'drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should ignore empty X-Forwarded-Host and fall back to Host header (trust proxy ON)', () => {
    // Even with trust proxy enabled, an all-empty X-Forwarded-Host falls back to Host.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      trustProxy: true,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-host': ' , , ',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should use first value from comma-separated x-forwarded-host (trust proxy ON)', () => {
    // getFirstForwardedValue picks the first non-empty entry from a comma-separated list.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      trustProxy: true,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'internal-host',
        origin: 'https://drydock.example.com',
        'x-forwarded-host': 'drydock.example.com, other-proxy.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should skip leading empty entries and use first non-empty value in x-forwarded-host (trust proxy ON)', () => {
    // Tests that candidate.length > 0 skips empty strings so ", drydock.example.com"
    // correctly resolves to "drydock.example.com".
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      trustProxy: true,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'internal-host',
        origin: 'https://drydock.example.com',
        'x-forwarded-host': ', drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // ─── Trust proxy gating ────────────────────────────────────────────────────

  test('trust proxy OFF: forged X-Forwarded-Host is ignored — expected origin uses Host header', () => {
    // Without trust proxy, X-Forwarded-Host must not influence the expected origin.
    // A client setting X-Forwarded-Host to their own domain must not bypass the check.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      trustProxy: false,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        // forged header — should be ignored
        'x-forwarded-host': 'attacker.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    // Host header matches origin → allowed
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('trust proxy OFF: forged X-Forwarded-Host cross-origin mutation is rejected (403)', () => {
    // If the forged XFH were trusted, origin 'https://attacker.example.com'
    // would match expectedOrigin and the request would pass — a real CSRF bypass.
    // With trust proxy off, expectedOrigin comes from Host so it stays 'https://drydock.example.com',
    // and the attacker origin is rejected.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      trustProxy: false,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://attacker.example.com',
        // forged header
        'x-forwarded-host': 'attacker.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('trust proxy ON: X-Forwarded-Host including port is honoured for expected origin', () => {
    // With trust proxy on, a legitimate reverse proxy may set X-Forwarded-Host with a port.
    // The port must be preserved so the origin comparison succeeds.
    const req = createReq({
      method: 'POST',
      protocol: 'https', // Express-resolved
      trustProxy: true,
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'internal:8080',
        origin: 'https://drydock.example.com:8443',
        'x-forwarded-host': 'drydock.example.com:8443',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('non-standard port in Host header is preserved — origin with same port passes', () => {
    // req.get('host') includes the port; it must not be stripped, otherwise
    // a request to drydock.example.com:9000 would fail to match the browser Origin.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com:9000',
        origin: 'https://drydock.example.com:9000',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('non-standard port in Host header — origin without port is rejected (port mismatch)', () => {
    // Confirms the port-preservation path: 'drydock.example.com:9000' ≠ 'drydock.example.com'.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com:9000',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  // ─── End trust proxy gating ────────────────────────────────────────────────

  test('should allow unsafe methods when referer matches request host', () => {
    const req = createReq({
      method: 'PATCH',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        referer: 'https://drydock.example.com/settings',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should reject unsafe methods when origin does not match request host', () => {
    const req = createReq({
      method: 'DELETE',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://attacker.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when both origin and referer are missing', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when host header is missing', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when host header is blank', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: '   ',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when origin is malformed', () => {
    const req = createReq({
      method: 'PUT',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'not-a-valid-origin',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when origin header is empty string', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: '',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when origin header is whitespace-only', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: '   ',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject unsafe methods when protocol is not http or https', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'ftp',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'ftp://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should skip CSRF validation for unsafe methods without cookies', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        host: 'drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should skip CSRF validation when cookie header is blank (whitespace-only)', () => {
    // The blank-cookie case is treated as "no session cookie" and bypasses CSRF checks.
    // If the cookieHeader.trim() check were replaced with "true", every string-typed cookie
    // would be treated as a session cookie. A blank cookie with no origin/referer would
    // then fail the origin check and be rejected instead of allowed.
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: '   ',
        host: 'drydock.example.com',
        // No origin or referer — if this were treated as a session cookie, it would be rejected
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should treat null method as unsafe and validate origin when cookies are present', () => {
    const req = createReq({
      method: null,
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should treat empty string method as unsafe (not in SAFE_METHODS set)', () => {
    const req = createReq({
      method: '',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should reject when expectedOrigin is undefined but requestOrigin is present', () => {
    // Protocol is missing → expectedOrigin becomes undefined
    const req = createReq({
      method: 'POST',
      protocol: 'ftp',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject when expectedOrigin is present but requestOrigin is undefined', () => {
    // Both origin and referer are absent → requestOrigin is undefined
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        // no origin, no referer
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should reject when both expectedOrigin and requestOrigin are undefined (no host, no origin)', () => {
    // Both undefined: !expectedOrigin (true) || !requestOrigin (true) fires,
    // whereas the mutant "false || requestOrigin !== expectedOrigin" evaluates
    // to "undefined !== undefined" = false → would allow.
    const req = createReq({
      method: 'POST',
      protocol: 'ftp',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        // no host, no origin, no referer → both expectedOrigin and requestOrigin are undefined
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });
});
