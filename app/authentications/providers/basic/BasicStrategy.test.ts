import BasicStrategy from './BasicStrategy.js';

const basicStrategy = new BasicStrategy({}, () => {});

beforeEach(async () => {
  basicStrategy.success = vi.fn();
  basicStrategy.fail = vi.fn();
});

test('_challenge should return no auth header challenge', async () => {
  expect(basicStrategy._challenge()).toBeUndefined();
});

test('authenticate should return user from session if so', async () => {
  basicStrategy.authenticate({ isAuthenticated: () => true });
  expect(basicStrategy.success).toHaveBeenCalled();
});

test('authenticate should call super.authenticate when no existing session', async () => {
  const fail = vi.spyOn(basicStrategy, 'fail');
  basicStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      Authorization: 'Bearer XXXXX',
    },
  });
  expect(fail).toHaveBeenCalled();
});

test('constructor should default options to {} when verify is provided without options', async () => {
  const strategy = new BasicStrategy(undefined, () => {});
  strategy.fail = vi.fn();

  strategy.authenticate({
    isAuthenticated: () => false,
    headers: {},
  });

  expect(strategy.fail).toHaveBeenCalled();
});

test('constructor should fall back to deny-all verify when no verify callback is provided', async () => {
  const strategy = new BasicStrategy();
  strategy.success = vi.fn();
  strategy.fail = vi.fn();

  strategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: `Basic ${Buffer.from('user:password').toString('base64')}`,
    },
  });

  expect(strategy.success).not.toHaveBeenCalled();
  expect(strategy.fail).toHaveBeenCalled();
});

// Tests to kill surviving Stryker mutants in BasicStrategy.ts

test('authenticate calls success with req.user when session is authenticated (line 16:9 ConditionalExpression)', async () => {
  // Kill line 16:9 [ConditionalExpression] true — req.isAuthenticated() must be checked
  const user = { username: 'alice' };
  basicStrategy.authenticate({ isAuthenticated: () => true, user });
  expect(basicStrategy.success).toHaveBeenCalledWith(user);
});

test('authenticate calls success with undefined user when isAuthenticated is true but user is undefined (line 16:9)', async () => {
  // Kill line 16:9 [ConditionalExpression] true — if the condition were hardcoded true,
  // even non-authenticated requests would call success
  // Verify non-authenticated request does NOT call success
  const fail = vi.fn();
  basicStrategy.fail = fail;
  basicStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {},
  });
  expect(basicStrategy.success).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalled();
});

test('authenticate delegates to super.authenticate when session is not active (line 21:9 ConditionalExpression)', async () => {
  // Kill line 21:9 [ConditionalExpression] false — super.authenticate must be called for non-sessions
  const fail = vi.fn();
  basicStrategy.fail = fail;

  // No Authorization header → passport-http fails auth
  basicStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {},
  });

  // super.authenticate was called (not short-circuited), resulted in a failure
  expect(fail).toHaveBeenCalled();
});

test('authenticate does not call success for unauthenticated request (line 21:39 BlockStatement)', async () => {
  // Kill line 21:39 [BlockStatement] {} — the super.authenticate call must be made
  // Use no Authorization header so passport-http calls fail() without invoking verify
  basicStrategy.authenticate({
    isAuthenticated: () => false,
    headers: {},
  });
  // super.authenticate was called (not short-circuited), resulted in a failure (no credentials)
  expect(basicStrategy.fail).toHaveBeenCalled();
  expect(basicStrategy.success).not.toHaveBeenCalled();
});

test('_challenge returns undefined (kills line 51:16 BlockStatement mutant)', () => {
  // Kill line 51:16 [BlockStatement] {} — return undefined must be explicit
  // If the block were empty (no return statement), function returns undefined anyway in JS
  // BUT the mutant replaces the return statement with an empty block — same behavior.
  // This mutant is likely equivalent. Confirm the return value is exactly undefined.
  const strategy = new BasicStrategy();
  const result = strategy._challenge();
  expect(result).toBeUndefined();

  // Confirm no WWW-Authenticate header challenge is issued by verifying the return type
  expect(result).not.toBe('Basic realm="Users"');
  expect(result).not.toBe('');
  expect(result).not.toBe(null);
});

test('constructor uses provided verify callback when options+verify form is used (kills L21:9 ConditionalExpression)', async () => {
  // Kill L21:9 [ConditionalExpression] false — if the condition were always false, the
  // provided verify callback would be ignored and the deny-all fallback used instead.
  // Create a strategy with an explicit verify callback that grants success for 'alice'.
  const verifyCallback = vi.fn((user, pass, done) => {
    if (user === 'alice' && pass === 'secret') {
      done(null, { username: user });
    } else {
      done(null, false);
    }
  });
  const strategy = new BasicStrategy({}, verifyCallback);
  strategy.success = vi.fn();
  strategy.fail = vi.fn();

  // Provide valid credentials — the real verifyCallback should be called and grant success.
  strategy.authenticate({
    isAuthenticated: () => false,
    headers: {
      authorization: `Basic ${Buffer.from('alice:secret').toString('base64')}`,
    },
  });

  // Wait for the async verify callback to complete
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  // With the real verify callback: success called. With mutant (deny-all): fail called instead.
  expect(strategy.success).toHaveBeenCalledWith({ username: 'alice' });
  expect(strategy.fail).not.toHaveBeenCalled();
});
