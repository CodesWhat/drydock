import { afterEach, describe, expect, test } from 'vitest';
import {
  getConfigFileInterpolatedKeys,
  getConfigFileLayer,
  resetConfigFileLayer,
  setConfigFileLayer,
} from './layer.js';

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

  test('interpolated keys default to empty before anything sets them', () => {
    expect(getConfigFileInterpolatedKeys()).toStrictEqual(new Set());
  });

  test('setConfigFileLayer without a second argument still defaults interpolated keys to empty', () => {
    setConfigFileLayer({ DD_SERVER_NAME: 'from-file' });
    expect(getConfigFileInterpolatedKeys()).toStrictEqual(new Set());
  });

  test('setConfigFileLayer records the interpolated keys passed alongside the layer', () => {
    setConfigFileLayer({ DD_SERVER_NAME: 'resolved-from-env' }, new Set(['DD_SERVER_NAME']));
    expect(getConfigFileInterpolatedKeys()).toStrictEqual(new Set(['DD_SERVER_NAME']));
  });

  test('resetConfigFileLayer restores the empty interpolated-keys set too', () => {
    setConfigFileLayer({ DD_SERVER_NAME: 'resolved-from-env' }, new Set(['DD_SERVER_NAME']));
    resetConfigFileLayer();
    expect(getConfigFileInterpolatedKeys()).toStrictEqual(new Set());
  });
});
