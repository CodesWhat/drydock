export const SHARED_TRIGGER_CONFIGURATION_KEYS = ['threshold', 'once', 'mode', 'order'];
const SHARED_TRIGGER_CONFIGURATION_KEY_SET = new Set(SHARED_TRIGGER_CONFIGURATION_KEYS);

function isRecord(value: unknown): value is Record<string, any> {
  return (
    value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
  );
}

function applyProviderSharedTriggerConfiguration(configurations: Record<string, any>) {
  const normalizedConfigurations: Record<string, any> = {};

  Object.keys(configurations || {}).forEach((provider) => {
    const providerConfigurations = configurations[provider];
    if (!isRecord(providerConfigurations)) {
      normalizedConfigurations[provider] = providerConfigurations;
      return;
    }

    const sharedConfiguration: Record<string, any> = {};
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
  valuesByName: Record<string, Record<string, Set<any>>>,
  triggerName: string,
  key: string,
  value: any,
) {
  const normalizedTriggerName = triggerName.toLowerCase();
  valuesByName[normalizedTriggerName] ??= {};
  valuesByName[normalizedTriggerName][key] ??= new Set();
  valuesByName[normalizedTriggerName][key].add(value);
}

function collectSharedValuesForTrigger(
  valuesByName: Record<string, Record<string, Set<any>>>,
  triggerName: string,
  triggerConfiguration: Record<string, any>,
) {
  for (const key of SHARED_TRIGGER_CONFIGURATION_KEYS) {
    const value = triggerConfiguration[key];
    if (value !== undefined) {
      addSharedTriggerValue(valuesByName, triggerName, key, value);
    }
  }
}

function collectValuesForProvider(
  valuesByName: Record<string, Record<string, Set<any>>>,
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

function collectValuesByName(
  configurations: Record<string, any>,
): Record<string, Record<string, Set<any>>> {
  const valuesByName: Record<string, Record<string, Set<any>>> = {};

  for (const providerConfigurations of Object.values(configurations)) {
    collectValuesForProvider(valuesByName, providerConfigurations);
  }

  return valuesByName;
}

function extractSharedValues(
  valuesByName: Record<string, Record<string, Set<any>>>,
): Record<string, any> {
  const shared: Record<string, any> = {};

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

function getSharedTriggerConfigurationByName(configurations: Record<string, any>) {
  const valuesByName = collectValuesByName(configurations);
  return extractSharedValues(valuesByName);
}

export function applySharedTriggerConfigurationByName(configurations: Record<string, any>) {
  const configurationsWithProviderSharedValues =
    applyProviderSharedTriggerConfiguration(configurations);
  const sharedConfigurationByName = getSharedTriggerConfigurationByName(
    configurationsWithProviderSharedValues,
  );
  const configurationsWithSharedValues: Record<string, any> = {};

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

function isValidTriggerGroup(entry: Record<string, any>): boolean {
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
  value: any,
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
  configurations: Record<string, any>,
  knownProviderSet: Set<string>,
  onTriggerGroupDetected?: (groupName: string, value: Record<string, any>) => void,
) {
  const triggerGroupDefaults: Record<string, Record<string, any>> = {};
  const providerConfigurations: Record<string, any> = {};

  for (const key of Object.keys(configurations)) {
    const value = configurations[key];
    const classification = classifyConfigurationEntry(key, value, knownProviderSet);
    if (classification === 'trigger-group') {
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
  triggerConfiguration: any,
  groupDefaults: Record<string, any> | undefined,
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
  triggerGroupDefaults: Record<string, Record<string, any>>,
) {
  if (!isRecord(providerConfig)) {
    return providerConfig;
  }

  const providerResult: Record<string, any> = {};
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
  providerConfigurations: Record<string, any>,
  triggerGroupDefaults: Record<string, Record<string, any>>,
) {
  const result: Record<string, any> = {};

  for (const provider of Object.keys(providerConfigurations)) {
    result[provider] = applyDefaultsToProviderConfiguration(
      providerConfigurations[provider],
      triggerGroupDefaults,
    );
  }

  return result;
}

function hasConfigurationEntries(configurations: Record<string, any> | null | undefined): boolean {
  return !!configurations && Object.keys(configurations).length > 0;
}

export function applyTriggerGroupDefaults(
  configurations: Record<string, any> | null | undefined,
  knownProviderSet: Set<string>,
  onTriggerGroupDetected?: (groupName: string, value: Record<string, any>) => void,
): Record<string, any> | null | undefined {
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
