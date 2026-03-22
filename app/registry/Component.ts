import joi from 'joi';
import log from '../log/index.js';
import { redactTriggerConfigurationInfrastructureDetails } from './trigger-config-redaction.js';

type AppLogger = typeof log;

export interface ComponentConfiguration {
  [key: string]: any;
}

type ConfigurationSchemaValidationResult = {
  error?: unknown;
  value?: unknown;
};

type ComponentConfigurationSchema = {
  validate?: (configuration: ComponentConfiguration) => ConfigurationSchemaValidationResult;
};

/**
 * Base Component Class.
 */
class Component {
  public joi: typeof joi;
  public log: AppLogger;
  public kind: string = '';
  public type: string = '';
  public name: string = '';
  public agent?: string;
  public configuration: ComponentConfiguration = {};

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
    configuration: ComponentConfiguration,
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
    const sanitizedConfiguration =
      kind.toLowerCase() === 'trigger'
        ? redactTriggerConfigurationInfrastructureDetails(maskedConfiguration)
        : maskedConfiguration;
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
   * Deregistger the component (do nothing by default).
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
  validateConfiguration(configuration: ComponentConfiguration): ComponentConfiguration {
    const schema = this.getConfigurationSchema();
    const schemaValidated =
      typeof schema?.validate === 'function'
        ? schema.validate(configuration)
        : { value: configuration };
    if (schemaValidated.error) {
      throw schemaValidated.error;
    }
    return schemaValidated.value ? (schemaValidated.value as ComponentConfiguration) : {};
  }

  /**
   * Get the component configuration schema.
   * Can be overridden by the component implementation class
   * @returns {*}
   */
  getConfigurationSchema(): ComponentConfigurationSchema {
    return this.joi.object();
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
  maskConfiguration(configuration?: ComponentConfiguration): ComponentConfiguration {
    return configuration || this.configuration;
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
   * Mask a String
   * @param value the value to mask
   * @param _nb unused legacy parameter
   * @param _char unused legacy parameter
   * @returns {string|undefined} the masked string
   */
  static mask(value: string | undefined, _nb = 1, _char = '*'): string | undefined {
    if (!value) {
      return undefined;
    }
    return '[REDACTED]';
  }
}

export default Component;
