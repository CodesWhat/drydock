// @ts-nocheck
import axios from 'axios';
import Trigger from '../Trigger.js';

/**
 * Rocket Chat Trigger implementation
 */
class Rocketchat extends Trigger {
    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            url: this.joi
                .string()
                .uri({ scheme: ['http', 'https'] })
                .replace(/\/$/, '')
                .required(),
            user: this.joi.object({
                id: this.joi.string().required(),
            }),
            auth: this.joi.object({
                token: this.joi.string().trim().required(),
            }),
            channel: this.joi.string().required(),
            alias: this.joi.string(),
            avatar: this.joi.string(),
            emoji: this.joi.string(),
            parse: this.joi.object({
                urls: this.joi.boolean(),
            }),
            disabletitle: this.joi.boolean().default(false),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return {
            ...this.configuration,
            auth: {
                token: Rocketchat.mask(this.configuration.auth.token),
            },
            user: {
                id: Rocketchat.mask(this.configuration.user.id),
            },
        };
    }

    async trigger(container) {
        return this.postMessage(this.composeMessage(container));
    }

    async triggerBatch(containers) {
        return this.postMessage(this.composeBatchMessage(containers));
    }

    /**
     * Send message through the Rocket Chat API.
     *
     * @param text
     * @returns {Promise<*>}
     */
    async postMessage(text) {
        const data = this.buildMessageBody(text);
        const options = this.buildRequestOptions();

        return axios.post(
            `${this.configuration.url}/api/v1/chat.postMessage`,
            data,
            options,
        );
    }

    /**
     * Build the message body with all configuration options.
     *
     * @param {string} text - The message text
     * @returns {Object} The message body
     */
    buildMessageBody(text) {
        const body = {
            channel: this.configuration.channel,
            text: text,
        };
        if (this.configuration.alias) {
            body.alias = this.configuration.alias;
        }
        if (this.configuration.avatar) {
            body.avatar = this.configuration.avatar;
        }
        if (this.configuration.emoji) {
            body.emoji = this.configuration.emoji;
        }
        if (this.configuration.parse?.urls) {
            body.parseUrls = this.configuration.parse.urls;
        }

        return body;
    }

    /**
     * Build HTTP request options for Rocket Chat API.
     *
     * @returns {Object} The request options
     */
    buildRequestOptions() {
        return {
            headers: {
                'X-User-Id': this.configuration.user.id,
                'X-Auth-Token': this.configuration.auth.token,
                'content-type': 'application/json',
                accept: 'application/json',
            },
        };
    }
}

export default Rocketchat;
