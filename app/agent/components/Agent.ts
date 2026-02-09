import Component, { ComponentConfiguration } from '../../registry/Component';
import joi from 'joi';

export default class Agent extends Component {
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
    maskConfiguration(
        configuration?: ComponentConfiguration,
    ): ComponentConfiguration {
        const config = configuration || this.configuration;
        return {
            ...config,
            secret: Component.mask(config.secret),
        };
    }
}
