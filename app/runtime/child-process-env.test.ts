import {
  buildComposeCommandEnvironment,
  buildHookCommandEnvironment,
} from './child-process-env.js';

describe('runtime/child-process-env', () => {
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
});
