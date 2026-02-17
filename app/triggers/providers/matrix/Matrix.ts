// @ts-nocheck
import axios from 'axios';
import Trigger from '../Trigger.js';

/**
 * Matrix Trigger implementation
 */
class Matrix extends Trigger {
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
      roomid: this.joi.string().required(),
      accesstoken: this.joi.string().required(),
      msgtype: this.joi.string().valid('m.notice', 'm.text').default('m.notice'),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['accesstoken']);
  }

  async trigger(container) {
    return this.postMessage(this.composeMessage(container));
  }

  async triggerBatch(containers) {
    return this.postMessage(this.composeBatchMessage(containers));
  }

  buildMessageEndpoint(txnId) {
    const roomId = encodeURIComponent(this.configuration.roomid);
    const transactionId = encodeURIComponent(txnId);
    return `${this.configuration.url}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${transactionId}`;
  }

  buildMessageBody(text) {
    return {
      msgtype: this.configuration.msgtype,
      body: text,
    };
  }

  generateTransactionId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async postMessage(text) {
    return axios.put(
      this.buildMessageEndpoint(this.generateTransactionId()),
      this.buildMessageBody(text),
      {
        headers: {
          Authorization: `Bearer ${this.configuration.accesstoken}`,
          'content-type': 'application/json',
        },
      },
    );
  }
}

export default Matrix;
