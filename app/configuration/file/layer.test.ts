import { afterEach, describe, expect, test } from 'vitest';
import { getConfigFileLayer, resetConfigFileLayer, setConfigFileLayer } from './layer.js';

describe('file/layer', () => {
  afterEach(() => {
    resetConfigFileLayer();
  });

  test('starts empty before anything sets it', () => {
    expect(getConfigFileLayer()).toStrictEqual({});
  });

  test('setConfigFileLayer replaces what getConfigFileLayer returns', () => {
    setConfigFileLayer({ DD_SERVER_NAME: 'from-file' });
    expect(getConfigFileLayer()).toStrictEqual({ DD_SERVER_NAME: 'from-file' });
  });

  test('resetConfigFileLayer restores the empty layer', () => {
    setConfigFileLayer({ DD_SERVER_NAME: 'from-file' });
    resetConfigFileLayer();
    expect(getConfigFileLayer()).toStrictEqual({});
  });
});
