import {
  bouncerColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  serverBadgeColor,
  updateKindColor,
} from '@/utils/display';

describe('display utilities', () => {
  describe('parseServer', () => {
    it('extracts name and env from "name (env)" format', () => {
      expect(parseServer('my-server (prod)')).toEqual({ name: 'my-server', env: 'prod' });
    });

    it('handles env with spaces', () => {
      expect(parseServer('host (staging us-east)')).toEqual({
        name: 'host',
        env: 'staging us-east',
      });
    });

    it('returns name only when no parentheses present', () => {
      expect(parseServer('Local')).toEqual({ name: 'Local', env: null });
    });

    it('handles empty string', () => {
      expect(parseServer('')).toEqual({ name: '', env: null });
    });
  });

  describe('serverBadgeColor', () => {
    it('returns success colors for prod env', () => {
      const c = serverBadgeColor('server (prod)');
      expect(c.bg).toBe('var(--dd-success-muted)');
      expect(c.text).toBe('var(--dd-success)');
    });

    it('returns warning colors for staging env', () => {
      const c = serverBadgeColor('server (staging)');
      expect(c.bg).toBe('var(--dd-warning-muted)');
      expect(c.text).toBe('var(--dd-warning)');
    });

    it('returns neutral colors for unknown env', () => {
      const c = serverBadgeColor('server (dev)');
      expect(c.bg).toBe('var(--dd-neutral-muted)');
      expect(c.text).toBe('var(--dd-neutral)');
    });

    it('returns neutral colors when no env', () => {
      const c = serverBadgeColor('Local');
      expect(c.bg).toBe('var(--dd-neutral-muted)');
      expect(c.text).toBe('var(--dd-neutral)');
    });
  });

  describe('registryLabel', () => {
    it('maps dockerhub', () => {
      expect(registryLabel('dockerhub')).toBe('Dockerhub');
    });

    it('maps ghcr', () => {
      expect(registryLabel('ghcr')).toBe('GHCR');
    });

    it('maps unknown to Custom', () => {
      expect(registryLabel('custom')).toBe('Custom');
      expect(registryLabel('whatever')).toBe('Custom');
    });

    it('uses registry host label for custom registry URLs', () => {
      expect(
        (registryLabel as any)('custom', 'https://myacr.azurecr.io/v2/library/nginx', 'acr'),
      ).toBe('myacr.azurecr.io');
    });
  });

  describe('registryColorBg', () => {
    it('returns info-muted for dockerhub', () => {
      expect(registryColorBg('dockerhub')).toBe('var(--dd-info-muted)');
    });

    it('returns alt-muted for ghcr', () => {
      expect(registryColorBg('ghcr')).toBe('var(--dd-alt-muted)');
    });

    it('returns neutral-muted for unknown', () => {
      expect(registryColorBg('custom')).toBe('var(--dd-neutral-muted)');
    });
  });

  describe('registryColorText', () => {
    it('returns info for dockerhub', () => {
      expect(registryColorText('dockerhub')).toBe('var(--dd-info)');
    });

    it('returns alt for ghcr', () => {
      expect(registryColorText('ghcr')).toBe('var(--dd-alt)');
    });

    it('returns neutral for unknown', () => {
      expect(registryColorText('custom')).toBe('var(--dd-neutral)');
    });
  });

  describe('updateKindColor', () => {
    it('returns danger for major', () => {
      expect(updateKindColor('major')).toEqual({
        bg: 'var(--dd-danger-muted)',
        text: 'var(--dd-danger)',
      });
    });

    it('returns warning for minor', () => {
      expect(updateKindColor('minor')).toEqual({
        bg: 'var(--dd-warning-muted)',
        text: 'var(--dd-warning)',
      });
    });

    it('returns primary for patch', () => {
      expect(updateKindColor('patch')).toEqual({
        bg: 'var(--dd-primary-muted)',
        text: 'var(--dd-primary)',
      });
    });

    it('returns neutral for digest', () => {
      expect(updateKindColor('digest')).toEqual({
        bg: 'var(--dd-neutral-muted)',
        text: 'var(--dd-neutral)',
      });
    });

    it('returns transparent for null', () => {
      expect(updateKindColor(null)).toEqual({ bg: 'transparent', text: 'transparent' });
    });
  });

  describe('bouncerColor', () => {
    it('returns success for safe', () => {
      expect(bouncerColor('safe')).toEqual({
        bg: 'var(--dd-success-muted)',
        text: 'var(--dd-success)',
      });
    });

    it('returns warning for unsafe', () => {
      expect(bouncerColor('unsafe')).toEqual({
        bg: 'var(--dd-warning-muted)',
        text: 'var(--dd-warning)',
      });
    });

    it('returns danger for blocked', () => {
      expect(bouncerColor('blocked')).toEqual({
        bg: 'var(--dd-danger-muted)',
        text: 'var(--dd-danger)',
      });
    });
  });
});
