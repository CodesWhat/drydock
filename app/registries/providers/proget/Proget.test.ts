import SelfHostedBasic from '../shared/SelfHostedBasic.js';
import Proget from './Proget.js';

const proget = new Proget();
proget.configuration = {
  url: 'https://proget.acme.com',
  login: 'drydock',
  password: 'secret',
};

test('Proget should be a SelfHostedBasic registry', () => {
  expect(proget).toBeInstanceOf(SelfHostedBasic);
});

test('validates configuration and requires a url', () => {
  expect(
    proget.validateConfiguration({ url: 'https://proget.acme.com', login: 'a', password: 'b' }),
  ).toStrictEqual({ url: 'https://proget.acme.com', login: 'a', password: 'b' });
  expect(() => proget.validateConfiguration({ login: 'a', password: 'b' })).toThrow();
});

test('masks secrets', () => {
  const masked = proget.maskConfiguration() as Record<string, string>;
  expect(masked.password).not.toBe('secret');
  expect(masked.login).toBe('drydock');
});

test('matches only the configured host', () => {
  expect(proget.match({ registry: { url: 'proget.acme.com' } })).toBe(true);
  expect(proget.match({ registry: { url: 'proget.acme.com.attacker.com' } })).toBe(false);
  expect(proget.match({ registry: { url: 'evilproget.acme.com' } })).toBe(false);
});

test('normalizes to the configured v2 endpoint', () => {
  expect(
    proget.normalizeImage({ name: 'feed/app', registry: { url: 'proget.acme.com' } }),
  ).toStrictEqual({ name: 'feed/app', registry: { url: 'https://proget.acme.com/v2' } });
});

test('authenticates with basic credentials, anonymous otherwise', async () => {
  const result = await proget.authenticate({}, { headers: {} });
  expect(result.headers.Authorization).toBe(
    `Basic ${Buffer.from('drydock:secret').toString('base64')}`,
  );
  const anon = new Proget();
  anon.configuration = { url: 'https://proget.acme.com' };
  expect((await anon.authenticate({}, { headers: {} })).headers.Authorization).toBeUndefined();
});
