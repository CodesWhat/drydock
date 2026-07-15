import { describe, expect, test, vi } from 'vitest';
import type { Container } from '../model/container.js';
import { classifyPreviewError, sendPreviewError, TRIGGER_ACTION } from './preview-errors.js';

function container(options: { registry?: unknown; imageName?: unknown } = {}): Container {
  const registry = Object.hasOwn(options, 'registry') ? options.registry : 'ghcr.io';
  const imageName = Object.hasOwn(options, 'imageName') ? options.imageName : 'private/web';
  return {
    id: 'container-1',
    name: 'web',
    image: {
      name: imageName,
      registry: { url: registry },
    },
  } as Container;
}

describe('preview errors', () => {
  test('exports the safe trigger-settings action', () => {
    expect(TRIGGER_ACTION).toEqual({ label: 'Open trigger settings', href: '/triggers' });
  });

  test.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ])('classifies HTTP %i as rejected registry credentials', (status, label) => {
    const result = classifyPreviewError(
      Object.assign(new Error('denied'), { status }),
      container(),
    );
    expect(result).toEqual({
      status,
      payload: {
        code: 'registry-auth-failed',
        message: `Authentication failed for ghcr.io: ${status} ${label}`,
        details: { reason: 'denied', registry: 'ghcr.io' },
        action: { label: 'Open registry settings', href: '/registries' },
      },
    });
  });

  test('uses a generic registry label when rejected credentials have no registry metadata', () => {
    const result = classifyPreviewError(
      Object.assign(new Error('denied'), { status: 401 }),
      container({ registry: null }),
    );
    expect(result.payload.message).toBe(
      'Authentication failed for the image registry: 401 Unauthorized',
    );
  });

  test.each([
    'registry-manager-unsupported',
    'registry-manager-misconfigured',
  ])('classifies %s as missing registry configuration', (code) => {
    const result = classifyPreviewError(
      Object.assign(new Error('bad registry'), { code }),
      container(),
    );
    expect(result.status).toBe(422);
    expect(result.payload).toMatchObject({
      code: 'registry-not-found',
      message: 'No matching registry configured for ghcr.io/private/web',
    });
  });

  test('does not duplicate a registry host already present in the image name', () => {
    const result = classifyPreviewError(
      Object.assign(new Error('bad registry'), { code: 'registry-manager-unsupported' }),
      container({ imageName: 'ghcr.io/private/web' }),
    );
    expect(result.payload.message).toBe('No matching registry configured for ghcr.io/private/web');
  });

  test.each([
    [container({ imageName: null }), 'No matching registry configured for ghcr.io'],
    [
      container({ registry: null, imageName: null }),
      'No matching registry configured for this image',
    ],
  ])('describes missing image metadata without a malformed reference', (target, message) => {
    const result = classifyPreviewError(
      Object.assign(new Error('bad registry'), { code: 'registry-manager-unsupported' }),
      target,
    );
    expect(result.payload.message).toBe(message);
  });

  test.each([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
  ])('classifies network code %s', (code) => {
    const result = classifyPreviewError(
      Object.assign(new Error('network down'), { code }),
      container(),
    );
    expect(result.status).toBe(503);
    expect(result.payload.code).toBe('registry-network-error');
  });

  test('classifies a network message without an error code and scrubs URL credentials', () => {
    const result = classifyPreviewError(
      new Error('ETIMEDOUT https://robot:token@registry.example/v2/'),
      container({ registry: 'https://registry.example/v2/' }),
    );
    expect(result.payload.details?.reason).toBe(
      'ETIMEDOUT https://[REDACTED]@registry.example/v2/',
    );
    expect(result.payload.details?.registry).toBe('registry.example');
  });

  test.each([
    'ECONNABORTED',
    'ECONNRESET',
    'ENETUNREACH',
  ])('classifies a network message containing %s without a structured code', (code) => {
    const result = classifyPreviewError(new Error(`request failed: ${code}`), container());
    expect(result.status).toBe(503);
    expect(result.payload.code).toBe('registry-network-error');
  });

  test('uses container-runtime language when a network failure has no registry', () => {
    const result = classifyPreviewError(
      Object.assign(new Error('offline'), { code: 'ECONNRESET' }),
      container({ registry: '', imageName: '' }),
    );
    expect(result.payload.message).toBe(
      'Unable to reach the container runtime while preparing the update preview',
    );
    expect(result.payload.action).toBeUndefined();
  });

  test.each([
    [Object.assign(new Error('missing'), { response: { status: 404 } })],
    [new Error('manifest unknown')],
    [new Error('manifest not found')],
  ])('classifies missing manifests', (error) => {
    const result = classifyPreviewError(error, container());
    expect(result.status).toBe(422);
    expect(result.payload.code).toBe('manifest-fetch-failed');
  });

  test('supports statusCode and malformed registry URLs without leaking generic failure shapes', () => {
    const result = classifyPreviewError(
      Object.assign(new Error('forbidden'), { statusCode: 403 }),
      container({ registry: 'http://[invalid' }),
    );
    expect(result.status).toBe(403);
    expect(result.payload.code).toBe('registry-auth-failed');
    expect(result.payload.details?.registry).toBe('[invalid');
  });

  test.each([
    new Error('runtime exploded'),
    'runtime string',
    null,
  ])('falls back to a typed runtime error for %s', (error) => {
    const result = classifyPreviewError(error, container({ registry: undefined }));
    expect(result.status).toBe(500);
    expect(result.payload.code).toBe('preview-runtime-error');
    expect(result.payload.message).toBe('Unable to prepare this update preview');
    expect(result.payload.details).toBeUndefined();
  });

  test('sends an exact typed payload', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const payload = { code: 'container-not-found' as const, message: 'Container not found' };
    sendPreviewError({ status } as never, 404, payload);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(payload);
  });
});
