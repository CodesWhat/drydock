import { buildHookCommandEnvironment } from './child-process-env.js';

describe('runtime/child-process-env', () => {
  test('returns empty env object when parent env is empty', () => {
    expect(buildHookCommandEnvironment({}, {})).toEqual({});
  });

  test('buildHookCommandEnvironment keeps only base allowlisted vars and applies overrides', () => {
    const parentEnv = {
      PATH: '/usr/bin',
      HOME: '/Users/test',
      SECRET_TOKEN: 'should-not-leak',
      LANG: undefined,
    };

    expect(buildHookCommandEnvironment({ PATH: '/custom/bin', EXTRA: '1' }, parentEnv)).toEqual({
      HOME: '/Users/test',
      PATH: '/custom/bin',
      EXTRA: '1',
    });
  });

  test('buildHookCommandEnvironment lets overrides shadow inherited keys', () => {
    const parentEnv = {
      PATH: '/usr/bin',
      USER: 'alice',
      SECRET_TOKEN: 'should-not-leak',
    };

    expect(
      buildHookCommandEnvironment(
        { PATH: '/custom/bin', USER: 'bob', SECRET_TOKEN: 'override-only' },
        parentEnv,
      ),
    ).toEqual({
      PATH: '/custom/bin',
      USER: 'bob',
      SECRET_TOKEN: 'override-only',
    });
  });
});
