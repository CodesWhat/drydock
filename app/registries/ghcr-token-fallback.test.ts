const mockGetState = vi.fn();
vi.mock('../registry/index.js', () => ({ getState: () => mockGetState() }));

import { getGhcrTokenFallback } from './ghcr-token-fallback.js';

describe('registries/getGhcrTokenFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the token when a ghcr instance has a non-empty token', () => {
    mockGetState.mockReturnValue({
      registry: {
        'ghcr-main': { type: 'ghcr', configuration: { token: 'ghp_mytoken' } },
      },
    });
    expect(getGhcrTokenFallback()).toBe('ghp_mytoken');
  });

  it('returns undefined when registry state is empty', () => {
    mockGetState.mockReturnValue({ registry: {} });
    expect(getGhcrTokenFallback()).toBeUndefined();
  });

  it('returns undefined when no ghcr providers exist', () => {
    mockGetState.mockReturnValue({
      registry: {
        'hub-main': { type: 'hub', configuration: { token: 'hub-token' } },
        'ecr-main': { type: 'ecr', configuration: { token: 'ecr-token' } },
      },
    });
    expect(getGhcrTokenFallback()).toBeUndefined();
  });

  it('returns undefined when ghcr instance has no token field', () => {
    mockGetState.mockReturnValue({
      registry: {
        'ghcr-main': { type: 'ghcr', configuration: {} },
      },
    });
    expect(getGhcrTokenFallback()).toBeUndefined();
  });

  it('returns undefined when ghcr token is empty string', () => {
    mockGetState.mockReturnValue({
      registry: {
        'ghcr-main': { type: 'ghcr', configuration: { token: '' } },
      },
    });
    expect(getGhcrTokenFallback()).toBeUndefined();
  });

  it('returns undefined when ghcr token is whitespace-only', () => {
    mockGetState.mockReturnValue({
      registry: {
        'ghcr-main': { type: 'ghcr', configuration: { token: '   ' } },
      },
    });
    expect(getGhcrTokenFallback()).toBeUndefined();
  });

  it('returns token from first ghcr instance when multiple are present', () => {
    mockGetState.mockReturnValue({
      registry: {
        'ghcr-first': { type: 'ghcr', configuration: { token: 'token-first' } },
        'ghcr-second': { type: 'ghcr', configuration: { token: 'token-second' } },
      },
    });
    expect(getGhcrTokenFallback()).toBe('token-first');
  });

  it('ignores non-ghcr instances even if they have a token field', () => {
    mockGetState.mockReturnValue({
      registry: {
        'ecr-main': { type: 'ecr', configuration: { token: 'ecr-token' } },
        'ghcr-main': { type: 'ghcr', configuration: { token: 'ghcr-token' } },
      },
    });
    expect(getGhcrTokenFallback()).toBe('ghcr-token');
  });
});
