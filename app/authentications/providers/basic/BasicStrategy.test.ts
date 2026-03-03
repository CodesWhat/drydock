import BasicStrategy from './BasicStrategy.js';

const basicStrategy = new BasicStrategy({}, () => {});

beforeEach(async () => {
  basicStrategy.success = vi.fn();
  basicStrategy.fail = vi.fn();
});

test('_challenge should return appropriate Auth header', async () => {
  expect(basicStrategy._challenge()).toEqual(401);
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
