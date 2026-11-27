import amqp, { type Channel, type ChannelModel } from 'amqplib';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface AmqpConfiguration extends TriggerConfiguration {
  url: string;
  exchange: string;
  routingkey: string;
  exchangetype: 'direct' | 'topic' | 'fanout' | 'headers';
  persistent: boolean;
  disabletitle: boolean;
}

/**
 * AMQP (RabbitMQ) Trigger implementation.
 * Payload contract adapted from What's up Docker (MIT, Copyright (c) 2019 Manfred Martin).
 */
class Amqp extends Trigger<AmqpConfiguration> {
  private connection?: ChannelModel;
  private channel?: Channel;

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({ scheme: ['amqp', 'amqps'] })
        .required(),
      exchange: this.joi.string().allow('').default(''),
      routingkey: this.joi.string().default('drydock-container'),
      exchangetype: this.joi.string().valid('direct', 'topic', 'fanout', 'headers').default('topic'),
      persistent: this.joi.boolean().default(true),
      disabletitle: this.joi.boolean().default(false),
    });
  }

  /**
   * Sanitize sensitive data (the url usually embeds the broker credentials).
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['url']);
  }

  /**
   * Get or create the AMQP channel, reconnecting after a dropped connection.
   * @returns {Promise<Channel>}
   */
  async getChannel(): Promise<Channel> {
    if (!this.connection) {
      const connection = await amqp.connect(this.configuration.url);
      connection.on('error', (error: Error) => {
        this.log.warn(`AMQP connection error (${error.message})`);
      });
      connection.on('close', () => {
        this.connection = undefined;
        this.channel = undefined;
      });
      this.connection = connection;
    }
    if (!this.channel) {
      const channel = await this.connection.createChannel();
      if (this.configuration.exchange) {
        await channel.assertExchange(this.configuration.exchange, this.configuration.exchangetype, {
          durable: true,
        });
      }
      this.channel = channel;
    }
    return this.channel;
  }

  /**
   * Publish a single container update to the broker.
   * @param container the container
   * @returns {Promise<boolean>}
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
   * Publish a batch of container updates to the broker.
   * @param containers
   * @returns {Promise<boolean>}
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
   * Publish a payload to the configured exchange and routing key.
   * @param message the payload
   * @returns {Promise<boolean>}
   */
  async publishMessage(message: Record<string, unknown>) {
    const channel = await this.getChannel();
    return channel.publish(
      this.configuration.exchange,
      this.configuration.routingkey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: this.configuration.persistent,
        contentType: 'application/json',
      },
    );
  }

  /**
   * Close the channel and connection on deregistration.
   */
  async deregisterComponent(): Promise<void> {
    await super.deregisterComponent();
    const { channel, connection } = this;
    this.channel = undefined;
    this.connection = undefined;
    try {
      await channel?.close();
      await connection?.close();
    } catch (error: unknown) {
      this.log.debug(`Error closing AMQP connection (${(error as Error).message})`);
    }
  }
}

export default Amqp;
