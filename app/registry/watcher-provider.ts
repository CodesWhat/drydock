/** The watcher provider used when `DD_WATCHER_{name}_PROVIDER` is not set. */
export const DEFAULT_WATCHER_PROVIDER = 'docker';

/**
 * Split a watcher's `provider` key off its configuration. The provider is not a provider
 * option, it picks the provider module, so it is removed before the provider's own schema
 * validates the rest. Only a non-empty string selects a provider; anything else is left in
 * place for the default provider's schema to reject as an unknown key.
 */
export function splitWatcherProvider<TConfiguration extends object>(
  configuration: TConfiguration,
): { provider: string; configuration: TConfiguration } {
  const { provider, ...rest } = configuration as Record<string, unknown>;
  if (typeof provider !== 'string' || provider.trim() === '') {
    return { provider: DEFAULT_WATCHER_PROVIDER, configuration };
  }
  return { provider: provider.trim().toLowerCase(), configuration: rest as TConfiguration };
}
