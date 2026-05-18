import { describe, expect, test, vi } from 'vitest';
import { requireSameOriginForMutations } from './csrf.js';

function createReq({ method = 'GET', protocol = 'http', headers = {} } = {}) {
  return {
    method,
    protocol,
    get: vi.fn((name) => headers[String(name).toLowerCase()]),
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

  test('should allow unsafe methods when forwarded proto indicates https behind reverse proxy', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-proto': 'https',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should accept x-forwarded-proto with trailing colon (https:)', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-proto': 'https:',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should normalize x-forwarded-proto to lowercase before comparison', () => {
    // Tests that parseProtocol lowercases the value.
    // If toLowerCase() were removed, 'HTTPS' would not equal 'https' and the request would be rejected.
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-proto': 'HTTPS',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should accept x-forwarded-proto with trailing colon (http:)', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'http://drydock.example.com',
        'x-forwarded-proto': 'http:',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should reject when x-forwarded-proto is an unsupported scheme', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'ftp://drydock.example.com',
        'x-forwarded-proto': 'ftp',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'CSRF validation failed' });
  });

  test('should allow unsafe methods when forwarded host/proto match browser origin', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock:3000',
        origin: 'https://drydock.example.com',
        'x-forwarded-host': 'drydock.example.com',
        'x-forwarded-proto': 'https',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should ignore empty forwarded values and fall back to request protocol and host', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-host': ' , , ',
        'x-forwarded-proto': ' , ',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should use first value from comma-separated x-forwarded-proto', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-proto': 'https, http',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should skip leading empty entries and use first non-empty value in x-forwarded-proto', () => {
    // Tests that candidate.length > 0 check skips empty strings, not >= 0.
    // If >= 0 were used, the empty string from ", https" would be taken as the protocol.
    const req = createReq({
      method: 'POST',
      protocol: 'http',
      headers: {
        cookie: 'connect.sid=s%3Atest',
        host: 'drydock.example.com',
        origin: 'https://drydock.example.com',
        'x-forwarded-proto': ', https',
      },
    });
    const res = createRes();
    const next = vi.fn();

    requireSameOriginForMutations(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('should use first value from comma-separated x-forwarded-host', () => {
    const req = createReq({
      method: 'POST',
      protocol: 'https',
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
