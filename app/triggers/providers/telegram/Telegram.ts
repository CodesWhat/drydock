import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface TelegramConfiguration extends TriggerConfiguration {
  bottoken: string;
  chatid: string;
  messageformat: 'Markdown' | 'HTML';
}

/**
 * Escape special characters.
 * @param {*} text
 * @returns
 */
function escapeMarkdown(text) {
  return text.replaceAll(/([\\_*`|!.[\](){}>+#=~-])/gm, String.raw`\$1`);
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Telegram Trigger implementation
 */
class Telegram extends Trigger<TelegramConfiguration> {
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
      messageformat: this.joi.string().valid('Markdown', 'HTML').insensitive().default('Markdown'),
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
   * @returns {void}
   */
  initTrigger() {
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
      return this.sendMessage(this.escape(body));
    }

    const title = this.renderSimpleTitle(container);

    return this.sendMessage(`${this.bold(title)}\n\n${this.escape(body)}`);
  }

  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    const body = this.renderBatchBody(containers, runtimeContext);
    if (this.configuration.disabletitle) {
      return this.sendMessage(this.escape(body));
    }

    const title = this.renderBatchTitle(containers, runtimeContext);
    return this.sendMessage(`${this.bold(title)}\n\n${this.escape(body)}`);
  }

  private escape(text: string): string {
    return this.getParseMode() === 'MarkdownV2' ? escapeMarkdown(text) : escapeHtml(text);
  }

  /**
   * Post a message to a Telegram chat.
   * @param text the text to post
   * @returns {Promise<>}
   */
  async sendMessage(text) {
    const response = await axios.post(
      `${this.apiUrl}/sendMessage`,
      {
        chat_id: this.configuration.chatid,
        text,
        parse_mode: this.getParseMode(),
      },
      { timeout: getOutboundHttpTimeoutMs() },
    );

    return response.data;
  }

  bold(text) {
    return (this.configuration.messageformat as string).toLowerCase() === 'markdown'
      ? `*${escapeMarkdown(text)}*`
      : `<b>${escapeHtml(text)}</b>`;
  }

  getParseMode() {
    return (this.configuration.messageformat as string).toLowerCase() === 'markdown'
      ? 'MarkdownV2'
      : 'HTML';
  }
}

export default Telegram;
