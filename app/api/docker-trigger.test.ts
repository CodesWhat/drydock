import { describe, expect, test } from 'vitest';

import {
  findDockerTriggerForContainer,
  getDockerTriggerSpecificity,
  isTriggerCompatibleWithContainer,
  isTriggerStructurallyCompatibleWithContainer,
  NO_DOCKER_TRIGGER_FOUND_ERROR,
} from './docker-trigger.js';

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

  test('includes compose triggers by default', () => {
    const composeTrigger = { type: 'dockercompose' };

    const result = findDockerTriggerForContainer(
      {
        'dockercompose.default': composeTrigger,
      },
      { id: 'c1' },
    );

    expect(result).toBe(composeTrigger);
  });

  test('can limit trigger types when requested', () => {
    const composeTrigger = { type: 'dockercompose' };

    const result = findDockerTriggerForContainer(
      {
        'dockercompose.default': composeTrigger,
      },
      { id: 'c1' },
      { triggerTypes: ['docker'] },
    );

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

  test('skips local portainer triggers when container belongs to an agent', () => {
    const localPortainer = { type: 'portainer' };
    const agentDocker = { type: 'docker', agent: 'remote-1' };

    const result = findDockerTriggerForContainer(
      {
        'portainer.local': localPortainer,
        'docker.remote': agentDocker,
      },
      { id: 'c1', agent: 'remote-1' },
    );

    expect(result).toBe(agentDocker);
  });

  test('requires a local Compose project and service identity for portainer triggers', () => {
    const trigger = { type: 'portainer' };
    const composeLabels = {
      'com.docker.compose.project': 'demo',
      'com.docker.compose.service': 'web',
    };

    expect(isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels: composeLabels })).toBe(
      true,
    );
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels: { 'com.docker.compose.project': 'demo' },
      }),
    ).toBe(false);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels: { 'com.docker.compose.service': 'web' },
      }),
    ).toBe(false);
    expect(isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels: {} })).toBe(false);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels: {
          'com.docker.compose.project': ' ',
          'com.docker.compose.service': 'web',
        },
      }),
    ).toBe(false);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels: {
          'com.docker.compose.project': 'demo',
          'com.docker.compose.service': ' ',
        },
      }),
    ).toBe(false);
  });

  test('only accepts tag candidates for portainer triggers', () => {
    const trigger = { type: 'portainer' };
    const labels = {
      'com.docker.compose.project': 'demo',
      'com.docker.compose.service': 'web',
    };

    expect(isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels })).toBe(true);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels,
        updateKind: { kind: 'tag' },
      }),
    ).toBe(true);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels,
        updateKind: { kind: 'digest' },
      }),
    ).toBe(false);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        labels,
        updateKind: { kind: 'unknown' },
      }),
    ).toBe(false);
  });

  test('keeps unknown Portainer candidates structurally associated until execution admission', () => {
    const trigger = { type: 'portainer' };
    const container = {
      id: 'c1',
      labels: {
        'com.docker.compose.project': 'demo',
        'com.docker.compose.service': 'web',
      },
      updateKind: { kind: 'unknown' as const },
    };

    expect(isTriggerStructurallyCompatibleWithContainer(trigger, container)).toBe(true);
    expect(isTriggerCompatibleWithContainer(trigger, container)).toBe(false);
  });

  test('does not let portainer claim Drydock self or infrastructure updates', () => {
    const trigger = { type: 'portainer' };
    const labels = {
      'com.docker.compose.project': 'demo',
      'com.docker.compose.service': 'drydock',
    };

    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        name: 'drydock',
        image: { name: 'drydock' },
        labels,
      }),
    ).toBe(false);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        image: { name: 'ghcr.io/codeswhat/drydock' },
        labels,
      }),
    ).toBe(false);
    expect(
      isTriggerCompatibleWithContainer(trigger, {
        id: 'c1',
        name: 'app',
        labels: { ...labels, 'dd.update.mode': 'infrastructure' },
      }),
    ).toBe(false);
  });

  test('falls through to a compatible Docker trigger when Portainer is not eligible', () => {
    const portainer = { type: 'portainer' };
    const docker = { type: 'docker' };
    const container = { id: 'c1', name: 'drydock', labels: {} };

    expect(
      findDockerTriggerForContainer(
        { 'portainer.update': portainer, 'docker.update': docker },
        container,
      ),
    ).toBe(docker);
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

  test('treats compose trigger as compatible when configured file is empty string', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '  ' },
      getDefaultComposeFilePath: () => '  ',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring.yml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels: {} });

    expect(result).toBe(true);
  });

  test('treats compose trigger as compatible when it has no getComposeFilesForContainer method', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring.yml' },
    };

    const result = isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels: {} });

    expect(result).toBe(true);
  });

  test('treats compose trigger as compatible when container has no compose files', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring.yml' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring.yml',
      getComposeFilesForContainer: () => [],
    };

    const result = isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels: {} });

    expect(result).toBe(true);
  });

  test('treats compose trigger as compatible when configured as directory matching container compose file', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring/compose.yaml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring/compose.yaml',
      },
    });

    expect(result).toBe(true);
  });

  test('treats compose trigger as compatible when configured directory has trailing slash', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring/' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring/compose.yaml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring/compose.yaml',
      },
    });

    expect(result).toBe(true);
  });

  test('treats compose trigger as compatible when container compose label path uses host mount prefix', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring/compose.yaml' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
      getComposeFilesForContainer: () => [
        '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      ],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files':
          '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      },
    });

    expect(result).toBe(true);
  });

  test('rejects compose trigger when generic directory suffix match is ambiguous across different roots', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/stacks/compose.yaml' },
      getDefaultComposeFilePath: () => '/opt/drydock/stacks/compose.yaml',
      getComposeFilesForContainer: () => ['/mnt/volume1/docker/stacks/compose.yaml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files': '/mnt/volume1/docker/stacks/compose.yaml',
      },
    });

    expect(result).toBe(false);
  });

  test('treats compose trigger as compatible when configured as directory and compose label path uses host mount prefix', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring',
      getComposeFilesForContainer: () => [
        '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      ],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files':
          '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      },
    });

    expect(result).toBe(true);
  });

  test('rejects compose trigger configured as generic directory when only ambiguous suffix segment matches', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/stacks' },
      getDefaultComposeFilePath: () => '/opt/drydock/stacks',
      getComposeFilesForContainer: () => ['/mnt/volume1/docker/stacks/compose.yaml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files': '/mnt/volume1/docker/stacks/compose.yaml',
      },
    });

    expect(result).toBe(false);
  });

  test('rejects compose trigger when configured directory does not match container compose file', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/mysql' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/mysql',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring/compose.yaml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, {
      id: 'c1',
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring/compose.yaml',
      },
    });

    expect(result).toBe(false);
  });

  test('getDockerTriggerSpecificity ranks a mismatched configured file as compose-catch-all, not compose-file-matched', () => {
    // isTriggerCompatibleWithContainer would already reject this trigger as a
    // *candidate* (see the compatibility test above using the same fixture),
    // so selectActionTrigger never reaches this branch in practice — but
    // getDockerTriggerSpecificity is a standalone exported function with its
    // own contract, independent of any particular caller's pre-filtering.
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/mysql' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/mysql',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring/compose.yaml'],
    };

    const result = getDockerTriggerSpecificity(trigger, {
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring/compose.yaml',
      },
    });

    expect(result).toBe('compose-catch-all');
  });

  test('treats compose trigger as compatible when no configured file path', () => {
    const trigger = {
      type: 'dockercompose',
      configuration: {},
      getDefaultComposeFilePath: () => null,
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring.yml'],
    };

    const result = isTriggerCompatibleWithContainer(trigger, { id: 'c1', labels: {} });

    expect(result).toBe(true);
  });

  test('prefers the compose trigger whose configured file matches the container compose labels', () => {
    const mysqlComposeTrigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/mysql/compose.yaml' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/mysql/compose.yaml',
      getComposeFilesForContainer: () => [
        '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      ],
    };
    const monitoringComposeTrigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring/compose.yaml' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring/compose.yaml',
      getComposeFilesForContainer: () => [
        '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
      ],
    };

    const result = findDockerTriggerForContainer(
      {
        'dockercompose.mysql': mysqlComposeTrigger,
        'dockercompose.monitoring': monitoringComposeTrigger,
      },
      {
        id: 'c1',
        labels: {
          'com.docker.compose.project.config_files':
            '/mnt/volume1/docker/stacks/test/monitoring/compose.yaml',
        },
      },
      { triggerTypes: ['dockercompose'] },
    );

    expect(result).toBe(monitoringComposeTrigger);
  });
});
