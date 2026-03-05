type DependencyMap = Record<string, unknown>;

type ResolveFunctionDependenciesOptions<TDependencies extends DependencyMap> = {
  requiredKeys?: readonly (keyof TDependencies)[];
  defaults?: Partial<TDependencies>;
  componentName: string;
};

export function assertRequiredFunctionDependencies<TDependencies extends DependencyMap>(
  options: Partial<TDependencies>,
  requiredKeys: readonly (keyof TDependencies)[],
  componentName: string,
  dependencyNamePrefix?: string,
): void {
  for (const key of requiredKeys) {
    if (typeof options[key] !== 'function') {
      const dependencyName = dependencyNamePrefix
        ? `${dependencyNamePrefix}.${String(key)}`
        : String(key);
      throw new TypeError(`${componentName} requires dependency "${dependencyName}"`);
    }
  }
}

export function resolveFunctionDependencies<TDependencies extends DependencyMap>(
  options: Partial<TDependencies>,
  {
    requiredKeys = [],
    defaults = {},
    componentName,
  }: ResolveFunctionDependenciesOptions<TDependencies>,
): TDependencies {
  const resolvedOptions: Partial<TDependencies> = { ...options };

  for (const [key, defaultValue] of Object.entries(defaults) as [
    keyof TDependencies,
    TDependencies[keyof TDependencies],
  ][]) {
    if (typeof resolvedOptions[key] !== 'function') {
      resolvedOptions[key] = defaultValue;
    }
  }

  assertRequiredFunctionDependencies(resolvedOptions, requiredKeys, componentName);
  return resolvedOptions as TDependencies;
}
