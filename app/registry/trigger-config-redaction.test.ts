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
