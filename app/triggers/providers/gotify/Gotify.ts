// @ts-nocheck
import { GotifyClient } from 'gotify-client';
import Trigger from '../Trigger.js';

/**
 * Gotify Trigger implementation
 */
class Gotify extends Trigger {
    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            url: this.joi.string().uri({
                scheme: ['http', 'https'],
            }),
            token: this.joi.string(),
            priority: this.joi.number().integer().min(0),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return this.maskFields(['token']);
    }

    /**
     * Init trigger.
     */
    initTrigger() {
        this.client = new GotifyClient(this.configuration.url, {
            app: this.configuration.token, // NOSONAR - token from admin configuration, not hardcoded
        });
    }

    /**
     * Send an HTTP Request to Gotify.
     * @param container the container
     * @returns {Promise<void>}
     */
    async trigger(container) {
        return this.client.message.createMessage({
            title: this.renderSimpleTitle(container),
            message: this.renderSimpleBody(container),
            priority: this.configuration.priority,
        });
    }

    /**
     * Dismiss a previously sent Gotify notification.
     * @param containerId the container identifier
     * @param triggerResult the result from createMessage containing the message id
     */
    async dismiss(containerId, triggerResult) {
        if (triggerResult?.id) {
            this.log.info(
                `Deleting Gotify message ${triggerResult.id} for container ${containerId}`,
            );
            await this.client.message.deleteMessage(triggerResult.id);
        }
    }

    /**
     * Send an HTTP Request to Gotify.
     * @param containers
     * @returns {Promise<*>}
     */
    async triggerBatch(containers) {
        return this.client.message.createMessage({
            title: this.renderBatchTitle(containers),
            message: this.renderBatchBody(containers),
            priority: this.configuration.priority,
        });
    }
}

export default Gotify;
