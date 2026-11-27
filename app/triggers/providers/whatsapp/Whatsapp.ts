import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

const DEFAULT_GRAPH_URL = 'https://graph.facebook.com/v19.0';

interface WhatsappConfiguration extends TriggerConfiguration {
  phonenumberid: string;
  token: string;
  recipient: string;
  url: string;
  disabletitle: boolean;
}

/**
 * WhatsApp Trigger implementation (Meta WhatsApp Cloud API).
 * Request contract adapted from What's up Docker (MIT, Copyright (c) 2019 Manfred Martin).
 */
class Whatsapp extends Trigger<WhatsappConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      phonenumberid: this.joi.string().trim().required(),
      token: this.joi.string().trim().required(),
      recipient: this.joi.string().trim().required(),
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .replace(/\/$/, '')
        .default(DEFAULT_GRAPH_URL),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['phonenumberid', 'token', 'recipient']);
  }

  /**
   * Notify WhatsApp with container update details.
   * @param container the container
   * @returns {Promise<*>}
   */
  async trigger(container) {
    return this.sendMessage(
      this.compose(this.renderSimpleTitle(container), this.renderSimpleBody(container)),
    );
  }

  /**
   * Notify WhatsApp with batch container update details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    return this.sendMessage(
      this.compose(
        this.renderBatchTitle(containers, runtimeContext),
        this.renderBatchBody(containers, runtimeContext),
      ),
    );
  }

  private compose(title: string, body: string): string {
    return this.configuration.disabletitle ? body : `*${title}*\n\n${body}`;
  }

  /**
   * Send a text message through the WhatsApp Cloud API.
   * @param text the message text
   * @returns {Promise<*>}
   */
  async sendMessage(text: string) {
    const endpoint = `${this.configuration.url}/${this.configuration.phonenumberid}/messages`;
    const response = await axios.post(
      endpoint,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: this.configuration.recipient,
        type: 'text',
        text: { preview_url: true, body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${this.configuration.token}`,
          'Content-Type': 'application/json',
        },
        timeout: getOutboundHttpTimeoutMs(),
      },
    );
    return response.data;
  }
}

export default Whatsapp;
