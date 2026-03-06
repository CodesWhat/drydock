import Anonymous from './Anonymous.js';

describe('Anonymous Authentication', () => {
  let anonymous;
  const originalAnonymousConfirmation = process.env.DD_AUTH_ANONYMOUS_CONFIRM;

  beforeEach(async () => {
    delete process.env.DD_AUTH_ANONYMOUS_CONFIRM;
    anonymous = new Anonymous();
  });

  afterAll(() => {
    if (originalAnonymousConfirmation === undefined) {
      delete process.env.DD_AUTH_ANONYMOUS_CONFIRM;
      return;
    }
    process.env.DD_AUTH_ANONYMOUS_CONFIRM = originalAnonymousConfirmation;
  });

  test('should create instance', async () => {
    expect(anonymous).toBeDefined();
    expect(anonymous).toBeInstanceOf(Anonymous);
  });

  test('should return anonymous strategy', async () => {
    process.env.DD_AUTH_ANONYMOUS_CONFIRM = 'true';
    const strategy = anonymous.getStrategy();
    expect(strategy).toBeDefined();
    expect(strategy.name).toBe('anonymous');
  });

  test('should require explicit anonymous auth confirmation', async () => {
    expect(() => anonymous.getStrategy()).toThrow(
      'Anonymous authentication requires DD_AUTH_ANONYMOUS_CONFIRM=true',
    );
  });

  test('should return strategy description', async () => {
    const description = anonymous.getStrategyDescription();
    expect(description).toEqual({
      type: 'anonymous',
      name: 'Anonymous',
    });
  });
});
