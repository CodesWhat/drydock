import { connect, type ConnectionOptions, type NatsConnection, nkeyAuthenticator } from 'nats';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface NatsConfiguration extends TriggerConfiguration {
  servers: string;
  subject: string;
  user?: string;
  password?: string;
  token?: string;
  /** NKey seed (starts with `SU`). */
  nkey?: string;
  disabletitle: boolean;
}

const encoder = new TextEncoder();

/**
 * NATS Trigger implementation.
 * Payload contract adapted from What's up Docker (MIT, Copyright (c) 2019 Manfred Martin).
 */
class Nats extends Trigger<NatsConfiguration> {
  private connection?: NatsConnection;

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      servers: this.joi.string().required(),
      subject: this.joi.string().default('drydock.container'),
      user: this.joi.string(),
      password: this.joi.string(),
      token: this.joi.string(),
      nkey: this.joi.string(),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['password', 'token', 'nkey']);
  }

  /**
   * Get the active NATS connection, reconnecting when it was closed.
   * @returns {Promise<NatsConnection>}
   */
  async getConnection(): Promise<NatsConnection> {
    if (!this.connection || this.connection.isClosed()) {
      const options: ConnectionOptions = {
        servers: this.configuration.servers
          .split(',')
          .map((server) => server.trim())
          .filter((server) => server.length > 0),
      };
      if (this.configuration.user && this.configuration.password) {
        options.user = this.configuration.user;
        options.pass = this.configuration.password;
      } else if (this.configuration.token) {
        options.token = this.configuration.token;
      } else if (this.configuration.nkey) {
        options.authenticator = nkeyAuthenticator(encoder.encode(this.configuration.nkey));
      }
      this.connection = await connect(options);
    }
    return this.connection;
  }

  /**
   * Publish a single container update to the NATS subject.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.publishMessage({
      title: this.configuration.disabletitle ? '' : this.renderSimpleTitle(container),
      message: this.renderSimpleBody(container),
      mode: 'simple',
      container,
    });
  }

  /**
   * Publish a batch of container updates to the NATS subject.
   * @param containers
   * @returns {Promise<void>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    return this.publishMessage({
      title: this.configuration.disabletitle
        ? ''
        : this.renderBatchTitle(containers, runtimeContext),
      message: this.renderBatchBody(containers, runtimeContext),
      mode: 'batch',
      eventKind: runtimeContext?.eventKind,
      count: containers.length,
      containers,
    });
  }

  /**
   * Publish a payload to the configured subject and flush it to the server.
   * @param message the payload
   * @returns {Promise<void>}
   */
  async publishMessage(message: Record<string, unknown>): Promise<void> {
    const connection = await this.getConnection();
    connection.publish(this.configuration.subject, encoder.encode(JSON.stringify(message)));
    await connection.flush();
  }

  /**
   * Drain and close the NATS connection on deregistration.
   */
  async deregisterComponent(): Promise<void> {
    await super.deregisterComponent();
    const connection = this.connection;
    this.connection = undefined;
    try {
      if (connection && !connection.isClosed()) {
        await connection.drain();
      }
    } catch (error: unknown) {
      this.log.debug(`Error draining NATS connection (${(error as Error).message})`);
    }
  }
}

export default Nats;
