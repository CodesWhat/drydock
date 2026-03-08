const REDACTED_TRIGGER_CONFIG_VALUE = '[REDACTED]';
const TRIGGER_INFRASTRUCTURE_CONFIG_KEYS = new Set([
  'host',
  'hostname',
  'url',
  'urls',
  'webhook',
  'webhookurl',
  'channel',
  'channelid',
  'roomid',
  'apikey',
  'token',
  'password',
  'username',
  'user',
  'botusername',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function redactTriggerInfrastructureValue(value: unknown): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      return value;
    }
    return REDACTED_TRIGGER_CONFIG_VALUE;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return REDACTED_TRIGGER_CONFIG_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactTriggerInfrastructureValue(entry));
  }
  return REDACTED_TRIGGER_CONFIG_VALUE;
}

export function redactTriggerConfigurationInfrastructureDetails(configuration: unknown): unknown {
  if (Array.isArray(configuration)) {
    return configuration.map((entry) => redactTriggerConfigurationInfrastructureDetails(entry));
  }
  if (!isPlainObject(configuration)) {
    return configuration;
  }

  const sanitizedConfiguration: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(configuration)) {
    const normalizedKey = key.toLowerCase();
    if (TRIGGER_INFRASTRUCTURE_CONFIG_KEYS.has(normalizedKey)) {
      sanitizedConfiguration[key] = redactTriggerInfrastructureValue(value);
      continue;
    }
    sanitizedConfiguration[key] = redactTriggerConfigurationInfrastructureDetails(value);
  }
  return sanitizedConfiguration;
}
