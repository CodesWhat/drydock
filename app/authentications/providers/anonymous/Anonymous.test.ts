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

    test('should throw from getStrategy without confirmation', () => {
      expect(() => anonymous.getStrategy()).toThrow(
        'Anonymous authentication cannot be enabled on a fresh install',
      );
    });

    test('should not throw during initAuthentication with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });

    test('should return anonymous strategy with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      const strategy = anonymous.getStrategy();
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe('anonymous');
    });

    test('should not throw during initAuthentication with DD_AUTH_ANONYMOUS_CONFIRM alias', () => {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });

    test('should return anonymous strategy with DD_AUTH_ANONYMOUS_CONFIRM alias', () => {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';
      const strategy = anonymous.getStrategy();
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe('anonymous');
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

    test('should fail closed from getStrategy without confirmation', () => {
      expect(() => anonymous.getStrategy()).toThrow(
        'Anonymous authentication cannot be enabled during an upgrade',
      );
    });

    test('should not downgrade the missing confirmation to a warning', () => {
      expect(() => anonymous.getStrategy()).toThrow();
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('should support the confirmation alias during an upgrade', () => {
      process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
      expect(anonymous.getStrategy()).toEqual(
        expect.objectContaining({
          name: 'anonymous',
        }),
      );
    });

    test('should not throw during initAuthentication with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });

    test('should return anonymous strategy with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      const strategy = anonymous.getStrategy();
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe('anonymous');
    });

    test('should not log warning with confirmation', () => {
      process.env.DD_ANONYMOUS_AUTH_CONFIRM = 'true';
      anonymous.initAuthentication();
      anonymous.getStrategy();
      expect(log.warn).not.toHaveBeenCalled();
    });
  });
});
