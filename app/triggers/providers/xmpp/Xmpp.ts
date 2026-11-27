import { client, xml } from '@xmpp/client';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface XmppConfiguration extends TriggerConfiguration {
  service: string;
  domain?: string;
  user: string;
  password: string;
  to: string;
  timeout: number;
}

/**
 * XMPP Trigger implementation. Opens a session per message, sends one chat
 * message and closes the session.
 * Session flow adapted from What's up Docker (MIT, Copyright (c) 2019 Manfred Martin).
 */
class Xmpp extends Trigger<XmppConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      service: this.joi
        .string()
        .uri({ scheme: ['xmpp', 'xmpps', 'ws', 'wss'] })
        .required(),
      domain: this.joi.string(),
      user: this.joi.string().required(),
      password: this.joi.string().required(),
      to: this.joi.string().required(),
      timeout: this.joi.number().greater(0).default(10_000),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['password']);
  }

  /**
   * Send an XMPP message with new container version details.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.sendMessage(this.renderSimpleTitle(container), this.renderSimpleBody(container));
  }

  /**
   * Send an XMPP message with new container versions details.
   * @param containers
   * @returns {Promise<void>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    return this.sendMessage(
      this.renderBatchTitle(containers, runtimeContext),
      this.renderBatchBody(containers, runtimeContext),
    );
  }

  /**
   * Post a chat message to the configured recipient.
   * @param title the title to post
   * @param body the body to post
   * @returns {Promise<void>}
   */
  async sendMessage(title: string, body: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const xmpp = client({
        service: this.configuration.service,
        domain: this.configuration.domain,
        username: this.configuration.user,
        password: this.configuration.password,
      });
      const stop = () => xmpp.stop().catch(() => undefined);

      const settle = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const timeoutHandle = setTimeout(() => {
        const error = new Error(`XMPP session timed out after ${this.configuration.timeout}ms`);
        this.log.error(error.message);
        settle(error);
        stop();
      }, this.configuration.timeout);

      // @xmpp/client reconnects after every disconnect until stopped, so every
      // failure path stops the client, and a reconnect that comes online after
      // the delivery already failed must not send it late.
      xmpp.on('error', (error: Error) => {
        this.log.error(`XMPP error (${error.message})`);
        settle(error);
        stop();
      });

      xmpp.on('online', async () => {
        if (settled) {
          await stop();
          return;
        }
        try {
          await xmpp.send(
            xml(
              'message',
              { type: 'chat', to: this.configuration.to },
              xml('body', {}, `${title}\n\n${body}`),
            ),
          );
          settle();
        } catch (error: unknown) {
          settle(error as Error);
        } finally {
          await stop();
        }
      });

      xmpp.start().catch((error: Error) => {
        this.log.error(`XMPP start error (${error.message})`);
        settle(error);
        stop();
      });
    });
  }
}

export default Xmpp;
