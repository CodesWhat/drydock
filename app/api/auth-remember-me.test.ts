import type { Response } from 'express';
import { describe, expect, type Mock, test, vi } from 'vitest';
import type { AuthRequest } from './auth-types.js';

const { mockGetCookieMaxAge, mockSendErrorResponse } = vi.hoisted(() => ({
  mockGetCookieMaxAge: vi.fn((days: number) => days * 86400000),
  mockSendErrorResponse: vi.fn(),
}));

vi.mock('./auth-session.js', () => ({
  getCookieMaxAge: mockGetCookieMaxAge,
  REMEMBER_ME_DAYS: 30,
}));

vi.mock('./error-response.js', () => ({
  sendErrorResponse: mockSendErrorResponse,
}));

import { applyRememberMe, setRememberMe } from './auth-remember-me.js';

function createMockRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    session: {
      cookie: { maxAge: null, expires: undefined as unknown as Date },
      rememberMe: false,
    },
    body: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('auth-remember-me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyRememberMe', () => {
    test('extends cookie maxAge when rememberMe is true', () => {
      const req = createMockRequest({
        session: {
          cookie: { maxAge: null, expires: undefined as unknown as Date },
          rememberMe: true,
        },
      } as Partial<AuthRequest>);

      applyRememberMe(req);

      expect(mockGetCookieMaxAge).toHaveBeenCalledWith(30);
      expect(req.session!.cookie.maxAge).toBe(30 * 86400000);
    });

    test('sets session cookie when rememberMe is false', () => {
      const req = createMockRequest({
        session: {
          cookie: { maxAge: 999, expires: new Date() },
          rememberMe: false,
        },
      } as Partial<AuthRequest>);

      applyRememberMe(req);

      expect(req.session!.cookie.expires).toBe(false);
      expect(req.session!.cookie.maxAge).toBeNull();
      expect(mockGetCookieMaxAge).not.toHaveBeenCalled();
    });

    test('returns early when session is undefined', () => {
      const req = createMockRequest({ session: undefined });

      applyRememberMe(req);

      expect(mockGetCookieMaxAge).not.toHaveBeenCalled();
    });

    test('returns early when session.cookie is undefined', () => {
      const req = createMockRequest({
        session: { rememberMe: true } as any,
      });

      applyRememberMe(req);

      expect(mockGetCookieMaxAge).not.toHaveBeenCalled();
    });
  });

  describe('setRememberMe', () => {
    test('stores remember=true in session and applies cookie', () => {
      const req = createMockRequest({
        body: { remember: true },
        session: {
          cookie: { maxAge: null, expires: undefined as unknown as Date },
          rememberMe: false,
        },
      } as Partial<AuthRequest>);
      const res = createMockResponse();

      setRememberMe(req, res);

      expect(req.session!.rememberMe).toBe(true);
      expect(mockGetCookieMaxAge).toHaveBeenCalledWith(30);
      expect((res.status as Mock).mock.calls[0][0]).toBe(200);
      expect((res.json as Mock).mock.calls[0][0]).toEqual({ ok: true });
    });

    test('stores remember=false when body.remember is not true', () => {
      const req = createMockRequest({
        body: { remember: false },
        session: {
          cookie: { maxAge: 999, expires: new Date() },
          rememberMe: true,
        },
      } as Partial<AuthRequest>);
      const res = createMockResponse();

      setRememberMe(req, res);

      expect(req.session!.rememberMe).toBe(false);
      expect(req.session!.cookie.maxAge).toBeNull();
      expect((res.status as Mock).mock.calls[0][0]).toBe(200);
    });

    test('treats missing body.remember as false', () => {
      const req = createMockRequest({
        body: {},
        session: {
          cookie: { maxAge: null, expires: undefined as unknown as Date },
          rememberMe: undefined,
        },
      } as Partial<AuthRequest>);
      const res = createMockResponse();

      setRememberMe(req, res);

      expect(req.session!.rememberMe).toBe(false);
    });

    test('treats undefined body as false', () => {
      const req = createMockRequest({
        body: undefined,
        session: {
          cookie: { maxAge: null, expires: undefined as unknown as Date },
          rememberMe: undefined,
        },
      } as Partial<AuthRequest>);
      const res = createMockResponse();

      setRememberMe(req, res);

      expect(req.session!.rememberMe).toBe(false);
    });

    test('sends 500 error when session is missing', () => {
      const req = createMockRequest({ session: undefined });
      const res = createMockResponse();

      setRememberMe(req, res);

      expect(mockSendErrorResponse).toHaveBeenCalledWith(res, 500, 'Unable to access session');
      expect(res.status as Mock).not.toHaveBeenCalled();
    });
  });
});
