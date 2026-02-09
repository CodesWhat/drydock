// @ts-nocheck
import { ClientSecretPost, Configuration } from 'openid-client';
import OidcStrategy from './OidcStrategy.js';
import log from '../../../log/index.js';

const oidcConfig = new Configuration(
    { issuer: 'https://idp.example.com' },
    'wud-client',
    'wud-secret',
    ClientSecretPost('wud-secret'),
);
const oidcStrategy = new OidcStrategy(
    {
        config: oidcConfig,
        scope: 'openid email profile',
        name: 'oidc',
    },
    () => {},
    log,
);

beforeEach(async () => {
    oidcStrategy.success = jest.fn();
    oidcStrategy.fail = jest.fn();
});

test('authenticate should return user from session if so', async () => {
    oidcStrategy.authenticate({ isAuthenticated: () => true });
    expect(oidcStrategy.success).toHaveBeenCalled();
});

test('authenticate should call super.authenticate when no existing session', async () => {
    const fail = jest.spyOn(oidcStrategy, 'fail');
    oidcStrategy.authenticate({ isAuthenticated: () => false, headers: {} });
    expect(fail).toHaveBeenCalled();
});

test('authenticate should get & validate Bearer token', async () => {
    const verify = jest.spyOn(oidcStrategy, 'verify');
    oidcStrategy.authenticate({
        isAuthenticated: () => false,
        headers: {
            authorization: 'Bearer XXXXX',
        },
    });
    expect(verify).toHaveBeenCalledWith('XXXXX', expect.any(Function));
});
