const SHARED_TRIGGER_CONFIGURATION_KEYS = ['threshold', 'once', 'mode', 'order'];
const SHARED_TRIGGER_CONFIGURATION_KEY_SET = new Set(SHARED_TRIGGER_CONFIGURATION_KEYS);

type UnknownRecord = Record<string, unknown>;
type SharedValuesByName = Record<string, Record<string, Set<unknown>>>;
type TriggerGroupDefaults = Record<string, UnknownRecord>;

function isRecord(value: unknown): value is UnknownRecord {
  return (
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
  );
}

function applyProviderSharedTriggerConfiguration(configurations: UnknownRecord) {
  const normalizedConfigurations: UnknownRecord = {};

  Object.keys(configurations || {}).forEach((provider) => {
    const providerConfigurations = configurations[provider];
    if (!isRecord(providerConfigurations)) {
      normalizedConfigurations[provider] = providerConfigurations;
      return;
    }

    const sharedConfiguration: UnknownRecord = {};
    Object.keys(providerConfigurations).forEach((key) => {
      const value = providerConfigurations[key];
      if (SHARED_TRIGGER_CONFIGURATION_KEY_SET.has(key.toLowerCase()) && !isRecord(value)) {
        sharedConfiguration[key.toLowerCase()] = value;
      }
    });

    normalizedConfigurations[provider] = {};
    Object.keys(providerConfigurations).forEach((triggerName) => {
      const triggerConfiguration = providerConfigurations[triggerName];
      if (isRecord(triggerConfiguration)) {
        normalizedConfigurations[provider][triggerName] = {
          ...sharedConfiguration,
          ...triggerConfiguration,
        };
      } else if (!SHARED_TRIGGER_CONFIGURATION_KEY_SET.has(triggerName.toLowerCase())) {
        normalizedConfigurations[provider][triggerName] = triggerConfiguration;
      }
    });
  });

  return normalizedConfigurations;
}

function addSharedTriggerValue(
  valuesByName: SharedValuesByName,
  triggerName: string,
  key: string,
  value: unknown,
) {
  const normalizedTriggerName = triggerName.toLowerCase();
  valuesByName[normalizedTriggerName] ??= {};
  valuesByName[normalizedTriggerName][key] ??= new Set();
  valuesByName[normalizedTriggerName][key].add(value);
}

function collectSharedValuesForTrigger(
  valuesByName: SharedValuesByName,
  triggerName: string,
  triggerConfiguration: UnknownRecord,
) {
  for (const key of SHARED_TRIGGER_CONFIGURATION_KEYS) {
    const value = triggerConfiguration[key];
    if (value !== undefined) {
      addSharedTriggerValue(valuesByName, triggerName, key, value);
    }
  }
}

function collectValuesForProvider(
  valuesByName: SharedValuesByName,
  providerConfigurations: unknown,
) {
  if (!isRecord(providerConfigurations)) {
    return;
  }

  for (const triggerName of Object.keys(providerConfigurations)) {
    const triggerConfiguration = providerConfigurations[triggerName];
    if (!isRecord(triggerConfiguration)) {
      continue;
    }
    collectSharedValuesForTrigger(valuesByName, triggerName, triggerConfiguration);
  }
}

function collectValuesByName(configurations: UnknownRecord): SharedValuesByName {
  const valuesByName: SharedValuesByName = {};

  for (const providerConfigurations of Object.values(configurations)) {
    collectValuesForProvider(valuesByName, providerConfigurations);
  }

  return valuesByName;
}

function extractSharedValues(valuesByName: SharedValuesByName): Record<string, UnknownRecord> {
  const shared: Record<string, UnknownRecord> = {};

  for (const triggerName of Object.keys(valuesByName)) {
    for (const key of SHARED_TRIGGER_CONFIGURATION_KEYS) {
      const valuesForKey = valuesByName[triggerName][key];
      if (valuesForKey?.size === 1) {
        if (!shared[triggerName]) {
          shared[triggerName] = {};
        }
        shared[triggerName][key] = Array.from(valuesForKey)[0];
      }
    }
  }

  return shared;
}

function getSharedTriggerConfigurationByName(configurations: UnknownRecord) {
  const valuesByName = collectValuesByName(configurations);
  return extractSharedValues(valuesByName);
}

export function applySharedTriggerConfigurationByName(configurations: UnknownRecord) {
  const configurationsWithProviderSharedValues =
    applyProviderSharedTriggerConfiguration(configurations);
  const sharedConfigurationByName = getSharedTriggerConfigurationByName(
    configurationsWithProviderSharedValues,
  );
  const configurationsWithSharedValues: UnknownRecord = {};

  Object.keys(configurationsWithProviderSharedValues).forEach((provider) => {
    const providerConfigurations = configurationsWithProviderSharedValues[provider];
    if (!isRecord(providerConfigurations)) {
      configurationsWithSharedValues[provider] = providerConfigurations;
      return;
    }
    configurationsWithSharedValues[provider] = {};
    Object.keys(providerConfigurations).forEach((triggerName) => {
      const triggerConfiguration = providerConfigurations[triggerName];
      if (!isRecord(triggerConfiguration)) {
        configurationsWithSharedValues[provider][triggerName] = triggerConfiguration;
        return;
      }
      const sharedConfiguration = sharedConfigurationByName[triggerName.toLowerCase()] || {};
      configurationsWithSharedValues[provider][triggerName] = {
        ...sharedConfiguration,
        ...triggerConfiguration,
      };
    });
  });

  return configurationsWithSharedValues;
}

function isValidTriggerGroup(entry: UnknownRecord): boolean {
  const keys = Object.keys(entry);
  return (
    keys.length > 0 &&
    keys.every(
      (k) => SHARED_TRIGGER_CONFIGURATION_KEY_SET.has(k.toLowerCase()) && !isRecord(entry[k]),
    )
  );
}

function classifyConfigurationEntry(
  key: string,
  value: unknown,
  knownProviderSet: Set<string>,
): 'provider' | 'trigger-group' {
  const keyLower = key.toLowerCase();
  if (knownProviderSet.has(keyLower)) {
    return 'provider';
  }
  if (isRecord(value) && isValidTriggerGroup(value)) {
    return 'trigger-group';
  }
  return 'provider';
}

function splitTriggerGroupDefaults(
  configurations: UnknownRecord,
  knownProviderSet: Set<string>,
  onTriggerGroupDetected?: (groupName: string, value: UnknownRecord) => void,
) {
  const triggerGroupDefaults: TriggerGroupDefaults = {};
  const providerConfigurations: UnknownRecord = {};

  for (const key of Object.keys(configurations)) {
    const value = configurations[key];
    const classification = classifyConfigurationEntry(key, value, knownProviderSet);
    if (classification === 'trigger-group' && isRecord(value)) {
      const keyLower = key.toLowerCase();
      triggerGroupDefaults[keyLower] = value;
      onTriggerGroupDetected?.(keyLower, value);
      continue;
    }
    providerConfigurations[key] = value;
  }

  return { triggerGroupDefaults, providerConfigurations };
}

function mergeTriggerConfigurationWithDefaults(
  triggerConfiguration: unknown,
  groupDefaults: UnknownRecord | undefined,
) {
  if (!groupDefaults || !isRecord(triggerConfiguration)) {
    return triggerConfiguration;
  }

  return {
    ...groupDefaults,
    ...triggerConfiguration,
  };
}

function applyDefaultsToProviderConfiguration(
  providerConfig: unknown,
  triggerGroupDefaults: TriggerGroupDefaults,
) {
  if (!isRecord(providerConfig)) {
    return providerConfig;
  }

  const providerResult: UnknownRecord = {};
  for (const triggerName of Object.keys(providerConfig)) {
    const triggerConfig = providerConfig[triggerName];
    const groupDefaults = triggerGroupDefaults[triggerName.toLowerCase()];
    providerResult[triggerName] = mergeTriggerConfigurationWithDefaults(
      triggerConfig,
      groupDefaults,
    );
  }

  return providerResult;
}

function applyDefaultsToProviderConfigurations(
  providerConfigurations: UnknownRecord,
  triggerGroupDefaults: TriggerGroupDefaults,
) {
  const result: UnknownRecord = {};

  for (const provider of Object.keys(providerConfigurations)) {
    result[provider] = applyDefaultsToProviderConfiguration(
      providerConfigurations[provider],
      triggerGroupDefaults,
    );
  }

  return result;
}

function hasConfigurationEntries(configurations: UnknownRecord | null | undefined): boolean {
  return !!configurations && Object.keys(configurations).length > 0;
}

export function applyTriggerGroupDefaults(
  configurations: UnknownRecord | null | undefined,
  knownProviderSet: Set<string>,
  onTriggerGroupDetected?: (groupName: string, value: UnknownRecord) => void,
): UnknownRecord | null | undefined {
  if (!hasConfigurationEntries(configurations)) {
    return configurations;
  }

  const { triggerGroupDefaults, providerConfigurations } = splitTriggerGroupDefaults(
    configurations,
    knownProviderSet,
    onTriggerGroupDetected,
  );

  if (!hasConfigurationEntries(triggerGroupDefaults)) {
    return configurations;
  }

  return applyDefaultsToProviderConfigurations(providerConfigurations, triggerGroupDefaults);
}
