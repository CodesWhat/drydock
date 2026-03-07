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

  beforeEach(async () => {
    delete process.env.DD_ANONYMOUS_AUTH_CONFIRM;
    mockIsUpgrade.mockReturnValue(false);
    vi.clearAllMocks();
    anonymous = new Anonymous();
  });

  afterAll(() => {
    if (originalAnonymousConfirmation === undefined) {
      delete process.env.DD_ANONYMOUS_AUTH_CONFIRM;
      return;
    }
    process.env.DD_ANONYMOUS_AUTH_CONFIRM = originalAnonymousConfirmation;
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
  });

  describe('upgrade (isUpgrade=true)', () => {
    beforeEach(() => {
      mockIsUpgrade.mockReturnValue(true);
    });

    test('should not throw during initAuthentication without confirmation', () => {
      expect(() => anonymous.initAuthentication()).not.toThrow();
    });

    test('should log warning during initAuthentication without confirmation', () => {
      anonymous.initAuthentication();
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('No authentication configured'),
      );
    });

    test('should return anonymous strategy without confirmation', () => {
      const strategy = anonymous.getStrategy();
      expect(strategy).toBeDefined();
      expect(strategy.name).toBe('anonymous');
    });

    test('should log warning from getStrategy without confirmation', () => {
      anonymous.getStrategy();
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Anonymous authentication is enabled without explicit confirmation',
        ),
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
