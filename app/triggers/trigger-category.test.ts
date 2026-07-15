import type { Container } from '../model/container.js';
import {
  getContainerTriggerFiltersForCategory,
  getTriggerCategoryForType,
} from './trigger-category.js';

function buildContainer(overrides: Partial<Container> = {}): Container {
  return { id: 'container-id', name: 'container-name', ...overrides } as Container;
}

describe('getTriggerCategoryForType', () => {
  test.each([
    'docker',
    'dockercompose',
    'command',
  ])('classifies %s as an action trigger', (type) => {
    expect(getTriggerCategoryForType(type)).toBe('action');
  });

  test.each([
    'slack',
    'smtp',
    'ntfy',
    'mqtt',
    'discord',
    'http',
  ])('classifies %s as a notification trigger', (type) => {
    expect(getTriggerCategoryForType(type)).toBe('notification');
  });

  test('is case insensitive', () => {
    expect(getTriggerCategoryForType('DockerCompose')).toBe('action');
    expect(getTriggerCategoryForType('SLACK')).toBe('notification');
  });

  test('classifies an unknown type as a notification trigger', () => {
    expect(getTriggerCategoryForType('something-new')).toBe('notification');
  });
});

describe('getContainerTriggerFiltersForCategory', () => {
  const container = buildContainer({
    actionTriggerInclude: 'docker',
    actionTriggerExclude: 'compose',
    notificationTriggerInclude: 'slack',
    notificationTriggerExclude: 'ntfy',
    triggerInclude: 'docker',
    triggerExclude: 'compose',
  });

  test('selects the action fields for an action trigger', () => {
    expect(getContainerTriggerFiltersForCategory(container, 'action')).toEqual({
      include: 'docker',
      exclude: 'compose',
    });
  });

  test('selects the notification fields for a notification trigger', () => {
    expect(getContainerTriggerFiltersForCategory(container, 'notification')).toEqual({
      include: 'slack',
      exclude: 'ntfy',
    });
  });

  test('does not fall back to the legacy mirror when the notification fields are unset', () => {
    const actionOnly = buildContainer({
      actionTriggerInclude: 'docker',
      actionTriggerExclude: 'compose',
      triggerInclude: 'docker',
      triggerExclude: 'compose',
    });

    expect(getContainerTriggerFiltersForCategory(actionOnly, 'notification')).toEqual({
      include: undefined,
      exclude: undefined,
    });
  });

  test('does not fall back to the legacy mirror when the action fields are unset', () => {
    const notificationOnly = buildContainer({
      notificationTriggerInclude: 'slack',
      notificationTriggerExclude: 'ntfy',
      triggerInclude: 'slack',
      triggerExclude: 'ntfy',
    });

    expect(getContainerTriggerFiltersForCategory(notificationOnly, 'action')).toEqual({
      include: undefined,
      exclude: undefined,
    });
  });

  test('returns undefined filters for a container with no trigger labels', () => {
    expect(getContainerTriggerFiltersForCategory(buildContainer(), 'action')).toEqual({
      include: undefined,
      exclude: undefined,
    });
    expect(getContainerTriggerFiltersForCategory(buildContainer(), 'notification')).toEqual({
      include: undefined,
      exclude: undefined,
    });
  });
});
