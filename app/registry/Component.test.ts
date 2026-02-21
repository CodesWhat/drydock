// @ts-nocheck
import Component from './Component.js';

beforeEach(async () => {
  vi.resetAllMocks();
});

test('mask should mask with * when called with defaults', async () => {
  expect(Component.mask('abcdefgh')).toStrictEqual('a******h');
});

test('mask should mask with § when called with § masking char', async () => {
  expect(Component.mask('abcdefgh', 1, '§')).toStrictEqual('a§§§§§§h');
});

test('mask should mask with § and keep 3 chars when called with § masking char and a number of 3', async () => {
  expect(Component.mask('abcdefgh', 3, '§')).toStrictEqual('abc§§fgh');
});

test('mask should return undefined when value is undefined', async () => {
  expect(Component.mask(undefined)).toStrictEqual(undefined);
});

test('mask should not fail when mask is longer than original string', async () => {
  expect(Component.mask('abc', 5)).toStrictEqual('***');
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
