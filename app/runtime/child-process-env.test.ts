import {
  buildComposeCommandEnvironment,
  buildHookCommandEnvironment,
} from './child-process-env.js';

describe('runtime/child-process-env', () => {
  test('returns empty env objects when parent env is empty', () => {
    expect(buildHookCommandEnvironment({}, {})).toEqual({});
    expect(buildComposeCommandEnvironment({})).toEqual({});
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

  test('buildComposeCommandEnvironment keeps compose and docker env vars only', () => {
    const parentEnv = {
      PATH: '/usr/bin',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      COMPOSE_FILE: 'compose.yaml',
      COMPOSE_PROJECT_NAME: 'drydock',
      CUSTOM_VAR: 'nope',
      HTTP_PROXY: 'http://proxy',
      NO_PROXY: undefined,
    };

    expect(buildComposeCommandEnvironment(parentEnv)).toEqual({
      PATH: '/usr/bin',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      COMPOSE_FILE: 'compose.yaml',
      COMPOSE_PROJECT_NAME: 'drydock',
      HTTP_PROXY: 'http://proxy',
    });
  });

  test('buildComposeCommandEnvironment matches COMPOSE_ prefix strictly at the start', () => {
    const parentEnv = {
      COMPOSE_FILE: 'compose.yaml',
      COMPOSE_: 'edge',
      COMPOSE__EXTRA: 'double-underscore',
      XCOMPOSE_FILE: 'nope',
      compose_FILE: 'nope',
      COMPOSE: 'nope',
    };

    expect(buildComposeCommandEnvironment(parentEnv)).toEqual({
      COMPOSE_FILE: 'compose.yaml',
      COMPOSE_: 'edge',
      COMPOSE__EXTRA: 'double-underscore',
    });
  });

  test('buildComposeCommandEnvironment handles large parent env input', () => {
    const largeParentEnv: Record<string, string> = {
      PATH: '/usr/bin',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      COMPOSE_PROJECT_NAME: 'drydock',
      SECRET_TOKEN: 'should-not-leak',
    };

    for (let index = 0; index < 5_000; index += 1) {
      largeParentEnv[`UNRELATED_${index}`] = `value-${index}`;
    }

    expect(buildComposeCommandEnvironment(largeParentEnv)).toEqual({
      PATH: '/usr/bin',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      COMPOSE_PROJECT_NAME: 'drydock',
    });
  });
});
