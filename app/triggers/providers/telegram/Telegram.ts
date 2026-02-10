// @ts-nocheck
import axios from 'axios';
import Trigger from '../Trigger.js';

/**
 * Escape special characters.
 * @param {*} text
 * @returns
 */
function escapeMarkdown(text) {
    return text.replace(/([\\_*`|!.[\](){}>+#=~-])/gm, '\\$1');
}

/**
 * Telegram Trigger implementation
 */
class Telegram extends Trigger {
    private apiUrl: string;

    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            bottoken: this.joi.string().required(),
            chatid: this.joi.string().required(),
            disabletitle: this.joi.boolean().default(false),
            messageformat: this.joi
                .string()
                .valid('Markdown', 'HTML')
                .insensitive()
                .default('Markdown'),
        });
    }

    /**
     * Sanitize sensitive data
     * @returns {*}
     */
    maskConfiguration() {
        return this.maskFields(['bottoken', 'chatid']);
    }

    /**
     * Init trigger (prepare telegram endpoint).
     * @returns {Promise<void>}
     */
    async initTrigger() {
        this.apiUrl = `https://api.telegram.org/bot${this.configuration.bottoken}`;
    }

    /*
     * Post a message with new image version details.
     *
     * @param image the image
     */
    async trigger(container) {
        const body = this.renderSimpleBody(container);

        if (this.configuration.disabletitle) {
            return this.sendMessage(body);
        }

        const title = this.renderSimpleTitle(container);

        return this.sendMessage(
            `${this.bold(title)}\n\n${escapeMarkdown(body)}`,
        );
    }

    async triggerBatch(containers) {
        const body = this.renderBatchBody(containers);
        if (this.configuration.disabletitle) {
            return this.sendMessage(body);
        }

        const title = this.renderBatchTitle(containers);
        return this.sendMessage(`${this.bold(title)}\n\n${body}`);
    }

    /**
     * Post a message to a Telegram chat.
     * @param text the text to post
     * @returns {Promise<>}
     */
    async sendMessage(text) {
        const response = await axios.post(`${this.apiUrl}/sendMessage`, {
            chat_id: this.configuration.chatid,
            text,
            parse_mode: this.getParseMode(),
        });

        return response.data;
    }

    bold(text) {
        return this.configuration.messageformat.toLowerCase() === 'markdown'
            ? `*${escapeMarkdown(text)}*`
            : `<b>${text}</b>`;
    }

    getParseMode() {
        return this.configuration.messageformat.toLowerCase() === 'markdown'
            ? 'MarkdownV2'
            : 'HTML';
    }
}

export default Telegram;
