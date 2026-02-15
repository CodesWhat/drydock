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

test('constructor should default verify callback to deny access when none is provided', async () => {
  const strategy = new BasicStrategy({});
  const done = vi.fn();
  (strategy as any)._verify('user', 'pass', done);
  expect(done).toHaveBeenCalledWith(null, false);
});
