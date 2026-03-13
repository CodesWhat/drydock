import { describe, expect, test } from 'vitest';

import {
  findDockerTriggerForContainer,
  isTriggerCompatibleWithContainer,
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
      configuration: { file: '/opt/drydock/test/mysql.yml' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/mysql.yml',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring.yml'],
    };
    const monitoringComposeTrigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring.yml' },
      getDefaultComposeFilePath: () => '/opt/drydock/test/monitoring.yml',
      getComposeFilesForContainer: () => ['/opt/drydock/test/monitoring.yml'],
    };

    const result = findDockerTriggerForContainer(
      {
        'dockercompose.mysql': mysqlComposeTrigger,
        'dockercompose.monitoring': monitoringComposeTrigger,
      },
      {
        id: 'c1',
        labels: {
          'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring.yml',
        },
      },
      { triggerTypes: ['dockercompose'] },
    );

    expect(result).toBe(monitoringComposeTrigger);
  });
});
