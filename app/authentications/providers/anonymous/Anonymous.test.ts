const mockIsUpgrade = vi.hoisted(() => vi.fn(() => false));

vi.mock('../../../store/app.js', () => ({
  isUpgrade: mockIsUpgrade,
}));

vi.mock('../../../log/index.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

import log from '../../../log/index.js';
import Anonymous from './Anonymous.js';

describe('Anonymous Authentication', () => {
  let anonymous: InstanceType<typeof Anonymous>;
  const originalAnonymousConfirmation = process.env.DD_ANONYMOUS_AUTH_CONFIRM;
  const originalAliasConfirmation = process.env.DD_AUTH_ANONYMOUS_CONFIRM;

  beforeEach(async () => {
    delete process.env.DD_ANONYMOUS_AUTH_CONFIRM;
    delete process.env.DD_AUTH_ANONYMOUS_CONFIRM;
    mockIsUpgrade.mockReturnValue(false);
    vi.clearAllMocks();
    anonymous = new Anonymous();
  });

  afterAll(() => {
    if (originalAnonymousConfirmation === undefined) {
      delete process.env.DD_ANONYMOUS_AUTH_CONFIRM;
    } else {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = originalAnonymousConfirmation;
    }
    if (originalAliasConfirmation === undefined) {
      delete process.env.DD_AUTH_ANONYMOUS_CONFIRM;
    } else {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = originalAliasConfirmation;
    }
  });

  test('should create instance', async () => {
    expect(anonymous).toBeDefined();
    expect(anonymous).toBeInstanceOf(Anonymous);
  });

  test('should return strategy description', async () => {
    const description = anonymous.getStrategyDescription();
    expect(description).toEqual({
      type: 'anonymous',
      name: 'Anonymous',
    });
  });

  describe('fresh install (isUpgrade=false)', () => {
    beforeEach(() => {
      mockIsUpgrade.mockReturnValue(false);
    });

    test('should throw during initAuthentication without confirmation', () => {
      expect(() => anonymous.initAuthentication()).toThrow(
        'No authentication configured and this is a fresh install',
      );
    });

    test('should not throw during initAuthentication with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });

    test('should not throw during initAuthentication with DD_AUTH_ANONYMOUS_CONFIRM alias', () => {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });
  });

  describe('upgrade (isUpgrade=true)', () => {
    beforeEach(() => {
      mockIsUpgrade.mockReturnValue(true);
    });

    test('should fail closed during initAuthentication without confirmation', () => {
      expect(() => anonymous.initAuthentication()).toThrow(
        'No authentication configured during an upgrade',
      );
    });

    test('should require the explicit confirmation variable during an upgrade', () => {
      expect(() => anonymous.initAuthentication()).toThrow(/DD_ANONYMOUS_AUTH_CONFIRM=true/);
    });

    test('should not downgrade the missing confirmation to a warning', () => {
      expect(() => anonymous.getAuthenticator()).toThrow();
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('should support the confirmation alias during an upgrade', () => {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
      expect(() => anonymous.getAuthenticator()).not.toThrow();
    });

    test('should not throw during initAuthentication with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });

    test('should return anonymous authenticator with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      expect(() => anonymous.getAuthenticator()).not.toThrow();
    });

    test('should not log warning with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      anonymous.initAuthentication();
      anonymous.getAuthenticator();
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  describe('getAuthenticator', () => {
    test('registers under the provider id and refuses to persist a session', async () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      await anonymous.register('authentication', 'anonymous', 'anonymous', {});

      const authenticator = anonymous.getAuthenticator();

      expect(authenticator.id).toBe('anonymous.anonymous');
      expect(authenticator.persistsSession).toBe(false);
    });

    test('resolves every request to an identity-free anonymous principal', async () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';

      await expect(anonymous.getAuthenticator().authenticate({} as never)).resolves.toEqual({
        kind: 'anonymous',
        username: 'anonymous',
      });
    });

    test('hands out a fresh principal per request', async () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      const authenticator = anonymous.getAuthenticator();

      const [first, second] = await Promise.all([
        authenticator.authenticate({} as never),
        authenticator.authenticate({} as never),
      ]);

      expect(first).not.toBe(second);
    });

    test('accepts the DD_AUTH_ANONYMOUS_CONFIRM alias', () => {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';

      expect(() => anonymous.getAuthenticator()).not.toThrow();
    });

    test('fails closed on a fresh install when access was not confirmed', () => {
      mockIsUpgrade.mockReturnValue(false);

      expect(() => anonymous.getAuthenticator()).toThrow(
        'Anonymous authentication cannot be enabled on a fresh install without DD_ANONYMOUS_AUTH_CONFIRM=true',
      );
    });

    test('fails closed during an upgrade when access was not confirmed', () => {
      mockIsUpgrade.mockReturnValue(true);

      expect(() => anonymous.getAuthenticator()).toThrow(
        'Anonymous authentication cannot be enabled during an upgrade without DD_ANONYMOUS_AUTH_CONFIRM=true',
      );
    });
  });
});
