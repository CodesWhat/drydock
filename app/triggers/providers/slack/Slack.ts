// @ts-nocheck
import { WebClient } from '@slack/web-api';
import Trigger from '../Trigger.js';

/*
 * Slack Trigger implementation
 */
class Slack extends Trigger {
    /*
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            token: this.joi.string().required(),
            channel: this.joi.string().required(),
            disabletitle: this.joi.boolean().default(false),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return this.maskFields(['token']);
    }

    /*
     * Init trigger.
     */
    initTrigger() {
        this.client = new WebClient(this.configuration.token);
    }

    formatTitleAndBody(title, body) {
        return `*${title}*\n\n${body}`;
    }

    async trigger(container) {
        return this.sendMessage(this.composeMessage(container));
    }

    async triggerBatch(containers) {
        return this.sendMessage(this.composeBatchMessage(containers));
    }

    /**
     * Post a message to a Slack channel.
     * @param text the text to post
     * @returns {Promise<ChatPostMessageResponse>}
     */
    async sendMessage(text) {
        return this.client.chat.postMessage({
            channel: this.configuration.channel,
            text,
        });
    }
}

export default Slack;
