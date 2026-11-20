import { redactTriggerConfigurationInfrastructureDetails } from './trigger-config-redaction.js';

test('should redact a nested HTTP bearer credential', () => {
  const sanitized = redactTriggerConfigurationInfrastructureDetails({
    url: 'https://example.com/webhook',
    method: 'POST',
    auth: {
      type: 'BEARER',
      bearer: 'sekret-bearer-value',
    },
  }) as Record<string, unknown>;

  expect(sanitized).toEqual({
    url: '[REDACTED]',
    method: 'POST',
    auth: {
      type: 'BEARER',
      bearer: '[REDACTED]',
    },
  });
  expect(JSON.stringify(sanitized)).not.toContain('sekret-bearer-value');
});

test('should redact a top-level bearer credential', () => {
  expect(
    redactTriggerConfigurationInfrastructureDetails({
      bearer: 'sekret-bearer-value',
      mode: 'simple',
    }),
  ).toEqual({
    bearer: '[REDACTED]',
    mode: 'simple',
  });
});

test('should redact a proxy URL that carries credentials', () => {
  const sanitized = redactTriggerConfigurationInfrastructureDetails({
    proxy: 'http://user:p%40ss@proxy.local:3128',
    mode: 'simple',
  });

  expect(sanitized).toEqual({ proxy: '[REDACTED]', mode: 'simple' });
});

test('should redact CI rebuild trigger coordinates, credential and variables', () => {
  const sanitized = redactTriggerConfigurationInfrastructureDetails({
    repository: 'acme/app',
    project: 'group/app',
    url: 'https://ghe.example.com/api/v3',
    token: 'sekret-trigger-value',
    variables: { REGISTRY_PASSWORD: 'sekret-variable-value' },
    ref: 'main',
  });
  expect(sanitized).toEqual({
    repository: '[REDACTED]',
    project: '[REDACTED]',
    url: '[REDACTED]',
    token: '[REDACTED]',
    variables: '[REDACTED]',
    ref: 'main',
  });
});
