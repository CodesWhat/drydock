import { describe, expect, test } from 'vitest';
import { buildImageReference } from './image-reference.js';

describe('buildImageReference', () => {
  test('uses colon separator for a plain tag', () => {
    expect(buildImageReference('https://registry.example.com/v2', 'myimage', 'latest')).toBe(
      'registry.example.com/myimage:latest',
    );
  });

  test('uses @ separator when tagOrDigest contains a colon (digest)', () => {
    expect(buildImageReference('https://registry.example.com/v2', 'myimage', 'sha256:abc123')).toBe(
      'registry.example.com/myimage@sha256:abc123',
    );
  });

  test('strips https:// scheme from the registry URL', () => {
    const result = buildImageReference('https://ghcr.io/v2', 'codeswhat/drydock', '1.5.0-rc.22');
    expect(result).toBe('ghcr.io/codeswhat/drydock:1.5.0-rc.22');
    expect(result).not.toContain('https://');
  });

  test('strips http:// scheme from the registry URL', () => {
    const result = buildImageReference('http://registry.example.com/v2', 'myimage', '1.0');
    expect(result).toBe('registry.example.com/myimage:1.0');
    expect(result).not.toContain('http://');
  });

  test('strips trailing /v2 from the registry URL', () => {
    const result = buildImageReference(
      'https://registry-1.docker.io/v2',
      'dgtlmoon/sockpuppetbrowser',
      '0.0.3',
    );
    expect(result).toBe('registry-1.docker.io/dgtlmoon/sockpuppetbrowser:0.0.3');
    expect(result).not.toMatch(/\/v2[^/]/);
  });

  test('strips trailing /v2/ (with trailing slash) from the registry URL', () => {
    const result = buildImageReference('https://registry.example.com/v2/', 'myimage', '1.0');
    expect(result).toBe('registry.example.com/myimage:1.0');
  });

  test('leaves a plain host with no scheme or /v2 unchanged', () => {
    const result = buildImageReference('fallback-registry', 'test/app', '1.2.3');
    expect(result).toBe('fallback-registry/test/app:1.2.3');
  });

  test('does NOT strip /v2 from the middle of an image name', () => {
    // The bug: unanchored .replace(/\/v2/, '') on the concatenated string would
    // remove the /v2 segment from the image name, not just the registry URL.
    const result = buildImageReference('plain-registry.io', 'library/v2/tool', '1.0');
    expect(result).toBe('plain-registry.io/library/v2/tool:1.0');
  });

  test('does NOT strip /v2 from the middle of an image name even with a scheme prefix on the URL', () => {
    const result = buildImageReference('https://plain-registry.io', 'library/v2/tool', '1.0');
    expect(result).toBe('plain-registry.io/library/v2/tool:1.0');
  });

  test('handles a digest when image name contains /v2 (both separator and name preserved)', () => {
    const result = buildImageReference(
      'https://registry.example.com/v2',
      'org/v2/image',
      'sha256:deadbeef',
    );
    expect(result).toBe('registry.example.com/org/v2/image@sha256:deadbeef');
  });

  test('known case: Docker Hub v2 API base + sockpuppetbrowser', () => {
    expect(
      buildImageReference('https://registry-1.docker.io/v2', 'dgtlmoon/sockpuppetbrowser', '0.0.3'),
    ).toBe('registry-1.docker.io/dgtlmoon/sockpuppetbrowser:0.0.3');
  });

  test('known case: ghcr.io v2 + drydock tag', () => {
    expect(buildImageReference('https://ghcr.io/v2', 'codeswhat/drydock', '1.5.0-rc.22')).toBe(
      'ghcr.io/codeswhat/drydock:1.5.0-rc.22',
    );
  });

  test('known case: ghcr.io v2 + drydock digest', () => {
    expect(buildImageReference('https://ghcr.io/v2', 'codeswhat/drydock', 'sha256:abc123')).toBe(
      'ghcr.io/codeswhat/drydock@sha256:abc123',
    );
  });
});
