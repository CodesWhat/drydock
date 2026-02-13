import { getEffectiveDisplayIcon } from '@/services/image-icon';

describe('image-icon service', () => {
  it('keeps custom modern icons unchanged', () => {
    expect(getEffectiveDisplayIcon('fas fa-star', 'library/nginx:latest')).toBe('fas fa-star');
    expect(getEffectiveDisplayIcon('hl-custom', 'library/nginx:latest')).toBe('hl-custom');
  });

  it('auto-resolves legacy mdi icon values from mapped image names', () => {
    expect(getEffectiveDisplayIcon('mdi:docker', 'library/nginx:latest')).toBe('hl-nginx');
    expect(getEffectiveDisplayIcon('mdi-docker', 'bitnami/postgres:16')).toBe('hl-postgresql');
  });

  it('strips namespaces, tags, and digests when resolving image base names', () => {
    expect(getEffectiveDisplayIcon('', 'ghcr.io/linuxserver/nginx@sha256:abcd')).toBe('hl-nginx');
    expect(getEffectiveDisplayIcon('', 'linuxserver/sonarr:latest')).toBe('hl-sonarr');
  });

  it('returns Drydock logo for the drydock image', () => {
    expect(getEffectiveDisplayIcon('mdi:docker', 'drydock')).toBe('/drydock-logo.png');
  });

  it('falls back to inferred slug when image is unmapped but has a usable name', () => {
    expect(getEffectiveDisplayIcon('', 'my-org/custom-service:1.2.3')).toBe('hl-custom-service');
  });

  it('falls back to docker icon when inferred base name is too short', () => {
    expect(getEffectiveDisplayIcon('mdi:docker', 'a')).toBe('fab fa-docker');
  });
});
