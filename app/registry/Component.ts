import joi from 'joi';
import log from '../log/index.js';

type AppLogger = typeof log;

export type ComponentConfiguration = object;

type ConfigurationSchemaValidationResult = {
  error?: unknown;
  value?: unknown;
};

type ComponentConfigurationSchema<TConfiguration extends ComponentConfiguration> = {
  validate?: (configuration: TConfiguration) => ConfigurationSchemaValidationResult;
};

/**
 * Base Component Class.
 */
class Component<TConfiguration extends ComponentConfiguration = ComponentConfiguration> {
  public joi: typeof joi;
  public log: AppLogger;
  public kind: string = '';
  public type: string = '';
  public name: string = '';
  public agent?: string;
  public configuration = {} as TConfiguration;

  /**
   * Constructor.
   */
  constructor() {
    this.joi = joi;
    this.log = log;
  }

  /**
   * Register the component.
   * @param kind the kind of the component
   * @param type the type of the component
   * @param name the name of the component
   * @param configuration the configuration of the component
   * @param agent the name of the agent if it is a remote component
   */
  async register(
    kind: string,
    type: string,
    name: string,
    configuration: TConfiguration,
    agent?: string,
  ): Promise<this> {
    // Child log for the component
    this.log = log.child({ component: `${kind}.${type}.${name}` });
    this.kind = kind;
    this.type = type;
    this.name = name;
    this.agent = agent;

    this.configuration = this.validateConfiguration(configuration);
    const maskedConfiguration = this.maskConfiguration(configuration);
    const sanitizedConfiguration = this.maskRegistrationLogConfiguration(maskedConfiguration);
    this.log.info(`Register with configuration ${JSON.stringify(sanitizedConfiguration)}`);
    await this.init();
    return this;
  }

  /**
   * Deregister the component.
   * @returns {Promise<void>}
   */
  async deregister(): Promise<this> {
    this.log.info('Deregister component');
    await this.deregisterComponent();
    return this;
  }

  /**
   * Deregister the component (do nothing by default).
   * @returns {Promise<void>}
   */

  async deregisterComponent(): Promise<void> {
    // Do nothing by default
  }

  /**
   * Validate the configuration of the component.
   *
   * @param configuration the configuration
   * @returns {*} or throw a validation error
   */
  validateConfiguration(configuration: TConfiguration): TConfiguration {
    const schema = this.getConfigurationSchema();
    const schemaValidated =
      typeof schema?.validate === 'function'
        ? schema.validate(configuration)
        : { value: configuration };
    if (schemaValidated.error) {
      throw schemaValidated.error;
    }
    return schemaValidated.value
      ? (schemaValidated.value as TConfiguration)
      : ({} as TConfiguration);
  }

  /**
   * Get the component configuration schema.
   * Can be overridden by the component implementation class
   * @returns {*}
   */
  getConfigurationSchema(): ComponentConfigurationSchema<TConfiguration> {
    return this.joi.object() as ComponentConfigurationSchema<TConfiguration>;
  }

  /**
   * Init the component.
   * Can be overridden by the component implementation class
   */

  init(): void | Promise<void> {
    return Promise.resolve();
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration(configuration?: TConfiguration): unknown {
    return configuration || this.configuration;
  }

  protected maskRegistrationLogConfiguration(configuration: unknown): unknown {
    return configuration;
  }

  /**
   * Get Component ID.
   * @returns {string}
   */
  getId(): string {
    const agentPrefix = this.agent ? `${this.agent}.` : '';
    return `${agentPrefix}${this.type}.${this.name}`;
  }

  /**
   * Mask a value that may hold a secret.
   *
   * One rule for every caller: a value is masked when it is present and still
   * non-empty after String() coercion. null, undefined and '' return undefined
   * (nothing to hide). Everything else returns the fixed '[REDACTED]' marker,
   * including whitespace-only strings, numbers (0 included), booleans and
   * objects, so a secret is never printed just because it is not a string.
   * @param value the value to mask
   * @returns {string|undefined} the masked string
   */
  static mask(value: unknown): string | undefined {
    if (value === undefined || value === null || String(value).length === 0) {
      return undefined;
    }
    return '[REDACTED]';
  }

  /**
   * Return a copy of the configuration with the given flat fields masked.
   * Absent and empty fields are left untouched. Providers with nested secrets
   * build their masked configuration by hand with Component.mask().
   * @param fields the configuration keys to mask
   */
  maskFields(fields: string[]): TConfiguration {
    const masked = { ...this.configuration } as Record<string, unknown>;
    for (const field of fields) {
      const maskedValue = (this.constructor as typeof Component).mask(masked[field]);
      if (maskedValue !== undefined) {
        masked[field] = maskedValue;
      }
    }
    return masked as TConfiguration;
  }
}

export default Component;
