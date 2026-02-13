import { describe, expect, test } from 'vitest';

import { findDockerTriggerForContainer, NO_DOCKER_TRIGGER_FOUND_ERROR } from './docker-trigger.js';

describe('docker-trigger helper', () => {
  test('exports the not-found error constant', () => {
    expect(NO_DOCKER_TRIGGER_FOUND_ERROR).toBe('No docker trigger found for this container');
  });

  test('returns undefined when trigger map is missing', () => {
    const container = { id: 'c1' };

    const result = findDockerTriggerForContainer(undefined, container);

    expect(result).toBeUndefined();
  });

  test('returns undefined when no docker trigger exists', () => {
    const triggers = {
      'slack.default': { type: 'slack' },
      'http.default': { type: 'http' },
    };

    const result = findDockerTriggerForContainer(triggers, { id: 'c1' });

    expect(result).toBeUndefined();
  });

  test('skips docker triggers with a different agent than the container', () => {
    const nonMatching = { type: 'docker', agent: 'agent-b' };
    const matching = { type: 'docker', agent: 'agent-a' };

    const result = findDockerTriggerForContainer(
      {
        'docker.wrong': nonMatching,
        'docker.right': matching,
      },
      { id: 'c1', agent: 'agent-a' },
    );

    expect(result).toBe(matching);
  });

  test('skips local docker triggers when container belongs to an agent', () => {
    const localDocker = { type: 'docker' };
    const agentDocker = { type: 'docker', agent: 'remote-1' };

    const result = findDockerTriggerForContainer(
      {
        'docker.local': localDocker,
        'docker.remote': agentDocker,
      },
      { id: 'c1', agent: 'remote-1' },
    );

    expect(result).toBe(agentDocker);
  });

  test('returns the first matching local docker trigger for local containers', () => {
    const firstDocker = { type: 'docker' };
    const secondDocker = { type: 'docker', agent: 'remote-1' };

    const result = findDockerTriggerForContainer(
      {
        'docker.first': firstDocker,
        'docker.second': secondDocker,
      },
      { id: 'c1' },
    );

    expect(result).toBe(firstDocker);
  });
});
