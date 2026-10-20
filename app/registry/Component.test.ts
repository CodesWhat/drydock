import log from '../log/index.js';
import Component from './Component.js';

beforeEach(async () => {
  vi.resetAllMocks();
});

test('mask should return fixed redaction marker when called with defaults', async () => {
  expect(Component.mask('abcdefgh')).toStrictEqual('[REDACTED]');
});

test('mask should return fixed redaction marker for non-empty values', () => {
  expect(Component.mask('registry-token')).toBe('[REDACTED]');
});

test('mask should return undefined when value is undefined', async () => {
  expect(Component.mask(undefined)).toStrictEqual(undefined);
});

test('mask should redact short values', async () => {
  expect(Component.mask('abc')).toStrictEqual('[REDACTED]');
});

test.each([
  ['undefined', undefined, undefined],
  ['null', null, undefined],
  ['empty string', '', undefined],
  ['whitespace string', ' ', '[REDACTED]'],
  ['short string', 'a', '[REDACTED]'],
  ['long string', 'a'.repeat(512), '[REDACTED]'],
  ['zero', 0, '[REDACTED]'],
  ['number', 42, '[REDACTED]'],
  ['false', false, '[REDACTED]'],
  ['true', true, '[REDACTED]'],
  ['plain object', { a: 1 }, '[REDACTED]'],
  ['empty object', {}, '[REDACTED]'],
  ['empty array', [], undefined],
  ['non-empty array', ['x'], '[REDACTED]'],
])('mask should handle %s', (_label, input, expected) => {
  expect(Component.mask(input)).toBe(expected);
});

test.each([
  ['non-empty string', { secret: 's3cret' }, '[REDACTED]'],
  ['empty string', { secret: '' }, ''],
  ['number', { secret: 0 }, '[REDACTED]'],
  ['boolean', { secret: false }, '[REDACTED]'],
  ['object', { secret: { a: 1 } }, '[REDACTED]'],
  ['null', { secret: null }, null],
])('maskFields should handle a %s value', (_label, configuration, expected) => {
  const component = new Component<Record<string, unknown>>();
  component.configuration = { ...configuration, keep: 'visible' };
  expect(component.maskFields(['secret'])).toStrictEqual({ secret: expected, keep: 'visible' });
  expect(component.configuration.keep).toBe('visible');
});

test('maskFields should not add keys for absent fields and should not mutate the configuration', () => {
  const component = new Component<Record<string, unknown>>();
  component.configuration = { secret: 'x' };
  const result = component.maskFields(['secret', 'missing']);
  expect(result).toStrictEqual({ secret: '[REDACTED]' });
  expect(component.configuration).toStrictEqual({ secret: 'x' });
});

test('getId should return the concatenation $type.$name', async () => {
  const component = new Component();
  component.register('kind', 'type', 'name', { x: 'x' });
  expect(component.getId()).toEqual('type.name');
});

test('register should call validateConfiguration and init methods of the component', async () => {
  const component = new Component();
  const spyValidateConsiguration = vi.spyOn(component, 'validateConfiguration');
  const spyInit = vi.spyOn(component, 'init');
  component.register('kind', 'type', 'name', { x: 'x' });
  expect(spyValidateConsiguration).toHaveBeenCalledWith({ x: 'x' });
  expect(spyInit).toHaveBeenCalledTimes(1);
});

test('register should use component hook to sanitize startup logs', async () => {
  class SanitizingComponent extends Component<Record<string, string>> {
    protected override maskRegistrationLogConfiguration(configuration: unknown) {
      return {
        ...(configuration as Record<string, string>),
        secret: '[HOOKED]',
      };
    }
  }

  const component = new SanitizingComponent();
  const info = vi.fn();
  vi.spyOn(log, 'child').mockReturnValue({ info } as any);

  await component.register('registry', 'custom', 'main', {
    secret: 'raw-secret',
  });

  const registrationLogMessage = info.mock.calls[0][0] as string;
  expect(registrationLogMessage).toContain('"secret":"[HOOKED]"');
  expect(registrationLogMessage).not.toContain('raw-secret');
});

test('register should not call init when validateConfiguration fails', async () => {
  const component = new Component();
  component.validateConfiguration = () => {
    throw new Error('validation failed');
  };
  const spyInit = vi.spyOn(component, 'init');
  await expect(component.register('type', 'name', { x: 'x' })).rejects.toThrowError(
    'validation failed',
  );
  expect(spyInit).toHaveBeenCalledTimes(0);
});

test('register should throw when init fails', async () => {
  const component = new Component();
  component.init = () => {
    throw new Error('init failed');
  };
  await expect(component.register('type', 'name', { x: 'x' })).rejects.toThrowError('init failed');
});

test('getId should include agent prefix when agent is set', async () => {
  const component = new Component();
  await component.register('kind', 'type', 'name', { x: 'x' }, 'myagent');
  expect(component.getId()).toEqual('myagent.type.name');
});

test('maskConfiguration should return this.configuration when no arg given', () => {
  const component = new Component();
  component.configuration = { foo: 'bar' };
  expect(component.maskConfiguration()).toEqual({ foo: 'bar' });
});

test('deregister should call deregisterComponent', async () => {
  const component = new Component();
  await component.register('kind', 'type', 'name', {});
  const spy = vi.spyOn(component, 'deregisterComponent');
  await component.deregister();
  expect(spy).toHaveBeenCalledTimes(1);
});

test('validateConfiguration should return empty object when value is falsy', () => {
  const component = new Component();
  // Override getConfigurationSchema to return schema that yields no value
  component.getConfigurationSchema = () => component.joi.object().keys({}).default(undefined);
  const result = component.validateConfiguration({});
  expect(result).toEqual({});
});

test('validateConfiguration should support schemas without a validate function', () => {
  const component = new Component();
  const configuration = { foo: 'bar' };
  component.getConfigurationSchema = () => ({}) as any;

  const result = component.validateConfiguration(configuration);

  expect(result).toEqual(configuration);
});
