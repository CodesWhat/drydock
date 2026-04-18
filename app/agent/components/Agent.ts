import type joi from 'joi';
import Component from '../../registry/Component.js';

export interface AgentConfiguration {
  host: string;
  port: number;
  secret: string;
  cafile?: string;
  certfile?: string;
  keyfile?: string;
}

export default class Agent extends Component<AgentConfiguration> {
  /**
   * Get the component configuration schema.
   * @returns {*}
   */
  getConfigurationSchema(): joi.ObjectSchema {
    return this.joi.object().keys({
      host: this.joi.string().required(),
      port: this.joi.number().port().default(3000),
      secret: this.joi.string().required(),
      cafile: this.joi.string().optional(),
      certfile: this.joi.string().optional(),
      keyfile: this.joi.string().optional(),
    });
  }

  /**
   * Mask the configuration.
   * @param configuration
   * @returns {*}
   */
  maskConfiguration(configuration?: AgentConfiguration): AgentConfiguration {
    const config = configuration || this.configuration;
    const secret = typeof config.secret === 'string' ? config.secret : undefined;
    return {
      ...config,
      secret: Component.mask(secret),
    };
  }
}
