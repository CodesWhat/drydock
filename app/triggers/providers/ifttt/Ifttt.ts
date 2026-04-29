import axios from 'axios';

import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface IftttConfiguration extends TriggerConfiguration {
  key: string;
  event: string;
}

/**
 * Ifttt Trigger implementation
 */
class Ifttt extends Trigger<IftttConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      key: this.joi.string().required(),
      event: this.joi.string().default('dd-image'),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['key']);
  }

  /**
   * Send an HTTP Request to Ifttt Webhook with new image version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.sendHttpRequest({
      value1: container.name,
      value2: container.result?.tag,
      value3: JSON.stringify(container),
    });
  }

  /**
   * end an HTTP Request to Ifttt Webhook with new image versions details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    // Security-digest (and any other prerendered-batch) callers supply
    // title/body in runtimeContext; surface them as value1/value2 so the
    // webhook receives the right text instead of a JSON dump of stub rows
    // (#328). Update-digest callers continue to receive the raw container
    // JSON in value1 for backwards compatibility.
    if (runtimeContext?.title || runtimeContext?.body) {
      return this.sendHttpRequest({
        value1: runtimeContext.title ?? '',
        value2: runtimeContext.body ?? '',
        value3: JSON.stringify(containers),
      });
    }
    return this.sendHttpRequest({
      value1: JSON.stringify(containers),
    });
  }

  /**
   * Send http request to ifttt.
   * @param body
   * @returns {Promise<*>}
   */
  async sendHttpRequest(body) {
    const options = {
      method: 'POST',
      url: `https://maker.ifttt.com/trigger/${this.configuration.event}/with/key/${this.configuration.key}`,
      headers: {
        'Content-Type': 'application/json',
      },
      data: body,
    };
    const response = await axios(options);
    return response.data;
  }
}

export default Ifttt;
