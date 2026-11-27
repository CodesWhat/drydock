import axios from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import type { Container } from '../../../model/container.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

const MAX_MESSAGE_LENGTH = 200;

interface UptimekumaConfiguration extends TriggerConfiguration {
  url: string;
  status: 'up' | 'down';
  msg?: string;
}

/**
 * Uptime Kuma Trigger implementation (push monitor).
 */
class Uptimekuma extends Trigger<UptimekumaConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .required(),
      status: this.joi.string().valid('up', 'down').default('up'),
      msg: this.joi.string(),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * The push URL carries the monitor's push key, so it is treated as a secret.
   */
  maskConfiguration() {
    return this.maskFields(['url']);
  }

  protected override formatTitleAndBody(title: string, body: string): string {
    return `${title}: ${body}`;
  }

  async trigger(container: Container) {
    return this.sendPush(this.configuration.msg ?? this.composeMessage(container));
  }

  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    return this.sendPush(
      this.configuration.msg ?? this.composeBatchMessage(containers, runtimeContext),
    );
  }

  /**
   * Call the Uptime Kuma push URL. Kuma shows short status messages, so the
   * text is capped.
   */
  async sendPush(msg: string) {
    const response = await axios.get(this.configuration.url, {
      params: {
        status: this.configuration.status,
        msg: msg.substring(0, MAX_MESSAGE_LENGTH),
      },
      timeout: getOutboundHttpTimeoutMs(),
    });
    return response.data;
  }
}

export default Uptimekuma;
