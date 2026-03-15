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
});
