// @ts-nocheck
import Custom from '../custom/Custom';

/**
 * DigitalOcean Container Registry integration.
 */
class Docr extends Custom {
    init() {
        this.configuration.url = 'https://registry.digitalocean.com';

        // Convenience alias: TOKEN can be used instead of PASSWORD.
        if (this.configuration.token) {
            this.configuration.password = this.configuration.token;
        }

        // DOCR commonly uses "doctl" as the username for token auth.
        if (
            !this.configuration.auth &&
            this.configuration.password &&
            !this.configuration.login
        ) {
            this.configuration.login = 'doctl';
        }
    }

    getConfigurationSchema() {
        return this.joi.alternatives([
            this.joi.string().allow(''),
            this.joi.object().keys({
                login: this.joi.string(),
                password: this.joi.string(),
                token: this.joi.string(),
                auth: this.joi.string().base64(),
            }),
        ]);
    }

    maskConfiguration() {
        return {
            ...this.configuration,
            url: this.configuration.url,
            login: this.configuration.login,
            password: Docr.mask(this.configuration.password),
            token: Docr.mask(this.configuration.token),
            auth: Docr.mask(this.configuration.auth),
        };
    }

    match(image) {
        return /^.*\.?registry.digitalocean.com$/.test(image.registry.url);
    }
}

export default Docr;
