/**
 * Shared mock factories for test files.
 *
 * These factories return plain functions/objects (not vi.fn() wrapped) so they
 * can be used with mockFn.mockImplementation() in beforeEach blocks.
 *
 * Due to vi.mock()/vi.hoisted() hoisting constraints, these CANNOT be used
 * inside vi.hoisted() callbacks. Instead, create bare vi.fn() stubs in
 * vi.hoisted(), wire them into vi.mock(), then set implementations in
 * beforeEach using these factories.
 */

import { vi } from 'vitest';

/**
 * Creates a mock Express router with vi.fn() stubs for the given HTTP methods.
 * Defaults to get, post, use.
 */
export function createMockRouter(
  methods: string[] = ['get', 'post', 'use'],
): Record<string, ReturnType<typeof vi.fn>> {
  const router: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of methods) {
    router[method] = vi.fn();
  }
  return router;
}

/**
 * Returns a fresh hash object with XOR-based deterministic digest.
 * Use as: mockCreateHash.mockImplementation(createMockHashObject)
 *
 * Each call to the mock produces a new hash with independent state.
 */
export function createMockHashObject() {
  const chunks: Buffer[] = [];
  const hash = {
    update(value: string, encoding?: BufferEncoding) {
      chunks.push(Buffer.from(value, encoding ?? 'utf8'));
      return hash;
    },
    digest() {
      const data = Buffer.concat(chunks);
      const digest = Buffer.alloc(32);
      for (let i = 0; i < data.length; i += 1) {
        digest[i % 32] ^= data[i];
      }
      return digest;
    },
  };
  return hash;
}

/**
 * Buffer-comparison implementation for timingSafeEqual mocks.
 * Use as: mockTimingSafeEqual.mockImplementation(mockTimingSafeEqualImpl)
 */
export function mockTimingSafeEqualImpl(left: Buffer, right: Buffer) {
  return left.length === right.length && left.equals(right);
}
